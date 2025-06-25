import os
import smtplib
from email.mime.text import MIMEText
from email.mime.multipart import MIMEMultipart
from dotenv import load_dotenv
import firebase_admin
from firebase_admin import credentials, firestore
from datetime import datetime, timedelta
from fastapi import FastAPI, BackgroundTasks, HTTPException, Request
from pydantic import BaseModel
from typing import Optional
import uvicorn
from fastapi.middleware.cors import CORSMiddleware
from fastapi.responses import JSONResponse
from geopy.geocoders import Nominatim
from geopy.exc import GeocoderTimedOut, GeocoderUnavailable

# Load environment variables
load_dotenv()

# Gmail credentials from .env file
GMAIL_USER = os.getenv("GMAIL_USER")
GMAIL_APP_PASSWORD = os.getenv("GMAIL_APP_PASSWORD")

# Initialize Firebase Admin SDK
# You'll need to download your Firebase service account key
# Go to Firebase Console > Project Settings > Service Accounts > Generate New Private Key
service_account_path = os.getenv("GOOGLE_APPLICATION_CREDENTIALS")
cred = credentials.Certificate(service_account_path)

# Only initialize if not already initialized
if not firebase_admin._apps:
    firebase_admin.initialize_app(cred)

# Get Firestore client
db = firestore.client()

# FastAPI app
app = FastAPI()

app.add_middleware(
    CORSMiddleware,
    allow_origins=["*"],  # Or specify ["http://localhost:8080"] for more security
    allow_credentials=True,
    allow_methods=["*"],
    allow_headers=["*"],
)

class Donation(BaseModel):
    category: str
    foodname: str
    geocode_location: str
    display_address: str
    phone: str
    count: int
    note: Optional[str] = None
    donor_email: str
    claimed: bool = False

class ClaimRequest(BaseModel):
    donation_id: str
    receiver_name: str
    receiver_email: str
    receiver_phone: str

def send_email(to_email, subject, body):
    """Send an email using Gmail SMTP."""
    msg = MIMEMultipart()
    msg["From"] = GMAIL_USER
    msg["To"] = to_email
    msg["Subject"] = subject

    msg.attach(MIMEText(body, "plain"))

    try:
        # Connect to Gmail SMTP server
        server = smtplib.SMTP("smtp.gmail.com", 587)
        server.starttls()
        server.login(GMAIL_USER, GMAIL_APP_PASSWORD)
        server.sendmail(GMAIL_USER, to_email, msg.as_string())
        server.quit()
        print(f"✅ Email sent to {to_email}")
        return True
    except Exception as e:
        print(f"❌ Error sending email to {to_email}: {e}")
        return False

def get_all_receivers():
    """Get all users with 'receiver' role from Firestore."""
    try:
        # Query users collection for users with 'receiver' role
        users_ref = db.collection('users')
        receivers = users_ref.where('roles', 'array_contains', 'receiver').stream()
        
        receiver_emails = []
        for user in receivers:
            user_data = user.to_dict()
            if 'email' in user_data:
                receiver_emails.append(user_data['email'])
        
        print(f"📧 Found {len(receiver_emails)} receivers")
        return receiver_emails
    except Exception as e:
        print(f"❌ Error fetching receivers: {e}")
        return []

def send_donation_alert(donation_data):
    """Send email alert to all receivers about new donation."""
    receiver_emails = get_all_receivers()
    if not receiver_emails:
        print("⚠️ No receivers found")
        return
    subject = "🍽️ New Food Donation Available on ShareBite!"
    body = f"""
Hello ShareBite Community!

A new food donation has been added to ShareBite:

🍽️ Food Item: {donation_data.get('foodname', 'N/A')}
📍 Location: {donation_data.get('display_address', 'N/A')}
📞 Contact: {donation_data.get('phone', 'N/A')}
👥 Serves: {donation_data.get('count', 'N/A')} people
📝 Notes: {donation_data.get('note', 'No additional notes')}
🍴 Category: {donation_data.get('category', 'N/A')}
⏰ Added: {datetime.now().strftime('%Y-%m-%d %H:%M:%S')}

Please log in to ShareBite to claim this donation if you're interested.

Best regards,
ShareBite Team
    """
    success_count = 0
    for email in receiver_emails:
        if send_email(email, subject, body):
            success_count += 1
    print(f"📬 Sent {success_count}/{len(receiver_emails)} emails successfully")

def cleanup_old_donations():
    """Remove donations older than 2 days from Firestore."""
    try:
        # Calculate cutoff in milliseconds
        cutoff = int(datetime.now().timestamp() * 1000) - 2 * 24 * 60 * 60 * 1000  # 2 days in ms
        donations_ref = db.collection('donations')
        old_donations = donations_ref.where('timestamp', '<', cutoff).stream()
        count = 0
        for donation in old_donations:
            print("Deleting donation with timestamp:", donation.to_dict().get('timestamp'))
            donation.reference.delete()
            count += 1
        print(f"🗑️ Deleted {count} old donations.")
    except Exception as e:
        print(f"❌ Error cleaning up old donations: {e}")

@app.post("/donation")
def create_donation(donation: Donation, background_tasks: BackgroundTasks):
    """Endpoint to create a new donation and send alerts."""
    try:
        # Geocode the location
        geolocator = Nominatim(user_agent="sharebite_app")
        latitude = None
        longitude = None
        
        try:
            print(f"Attempting to geocode address: '{donation.geocode_location}'")
            location_data = geolocator.geocode(donation.geocode_location)
            print(f"Geocoder result: {location_data}")
            
            if location_data:
                latitude = location_data.latitude
                longitude = location_data.longitude
        except (GeocoderTimedOut, GeocoderUnavailable):
            print("Geocoding service timed out or is unavailable.")
        except Exception as e:
            print(f"An error occurred during geocoding: {e}")

        # Store donation in Firestore with timestamp and coordinates
        donation_dict = donation.dict()
        donation_dict['timestamp'] = int(datetime.now().timestamp() * 1000)
        donation_dict['latitude'] = latitude
        donation_dict['longitude'] = longitude
        
        db.collection('donations').add(donation_dict)
        
        # Send email alerts in background
        background_tasks.add_task(send_donation_alert, donation_dict)
        # Cleanup old donations in background
        background_tasks.add_task(cleanup_old_donations)
        
        return {"message": "Donation created and alerts sent."}
    except Exception as e:
        print(f"❌ Error in donation endpoint: {e}")
        raise HTTPException(status_code=500, detail="Failed to create donation.")

@app.post("/claim_donation")
def claim_donation(claim: ClaimRequest, background_tasks: BackgroundTasks):
    """Endpoint to claim a donation, save claim to Firestore, mark donation as claimed, and notify donor and receiver."""
    try:
        # Get the donation document
        donation_ref = db.collection('donations').document(claim.donation_id)
        donation_doc = donation_ref.get()
        if not donation_doc.exists:
            raise HTTPException(status_code=404, detail="Donation not found.")
        donation_data = donation_doc.to_dict()
        # Save claim to 'claims' collection
        claim_data = {
            'donation_id': claim.donation_id,
            'receiver_name': claim.receiver_name,
            'receiver_email': claim.receiver_email,
            'receiver_phone': claim.receiver_phone,
            'claimed_at': int(datetime.now().timestamp() * 1000),
            'donor_email': donation_data.get('donor_email', None),
            'foodname': donation_data.get('foodname', None),
            'location': donation_data.get('display_address', None),
        }
        db.collection('claims').add(claim_data)
        # Mark donation as claimed (delete or update)
        donation_ref.update({'claimed': True})
        # Email the donor
        donor_email = donation_data.get('donor_email')
        if donor_email:
            subject = f"Your donation '{donation_data.get('foodname', '')}' has been claimed!"
            body = f"""
Hello,

Your donation '{donation_data.get('foodname', '')}' has been claimed by:
Name: {claim.receiver_name}
Email: {claim.receiver_email}
Phone: {claim.receiver_phone}

The receiver will contact you soon to arrange pickup.

Thank you for your generosity!

- ShareBite Team
"""
            background_tasks.add_task(send_email, donor_email, subject, body)
        # Email the receiver
        receiver_email = claim.receiver_email
        if receiver_email:
            subject = f"You have successfully claimed '{donation_data.get('foodname', '')}' on ShareBite!"
            body = f"""
Hello {claim.receiver_name},

Congratulations! You have successfully claimed the following donation on ShareBite:

🍽️ Food Item: {donation_data.get('foodname', 'N/A')}
📍 Location: {donation_data.get('display_address', 'N/A')}
👥 Serves: {donation_data.get('count', 'N/A')} people
📝 Notes: {donation_data.get('note', 'No additional notes')}
🍴 Category: {donation_data.get('category', 'N/A')}

Please contact the donor as soon as possible to arrange pickup:
Donor Phone: {donation_data.get('phone', 'N/A')}
Donor Email: {donation_data.get('donor_email', 'N/A')}

Thank you for using ShareBite!

- ShareBite Team
"""
            background_tasks.add_task(send_email, receiver_email, subject, body)
        return {"message": "Donation claimed and donor and receiver notified."}
    except Exception as e:
        print(f"❌ Error in claim_donation endpoint: {e}")
        raise HTTPException(status_code=500, detail="Failed to claim donation.")

@app.get("/donations")
def get_donations():
    """Endpoint to get all unclaimed donations."""
    try:
        donations_ref = db.collection('donations')
        # Filter for donations that are not claimed
        unclaimed_donations_query = donations_ref.where('claimed', '==', False).stream()
        
        donations_list = []
        for doc in unclaimed_donations_query:
            donation_data = doc.to_dict()
            donation_data['id'] = doc.id # Include the document ID
            donations_list.append(donation_data)
            
        return donations_list
    except Exception as e:
        print(f"❌ Error fetching donations: {e}")
        raise HTTPException(status_code=500, detail="Failed to fetch donations.")

if __name__ == "__main__":
    print("🚀 ShareBite Email Alert API Starting...")
    print(f"📧 Using Gmail: {GMAIL_USER}")
    
    # Test email functionality
    # send_email("test@example.com", "Test", "This is a test email")
    
    # Start listening for donations
    uvicorn.run("email_alert:app", host="0.0.0.0", port=8000, reload=True) 