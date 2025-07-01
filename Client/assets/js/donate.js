// donate.js
// Remove Firebase imports and initialization

import { initializeApp } from "https://www.gstatic.com/firebasejs/10.12.5/firebase-app.js";
import { getAuth } from "https://www.gstatic.com/firebasejs/10.12.5/firebase-auth.js";

// Firebase configuration
const firebaseConfig = {
    apiKey: "AIzaSyDIABA24iizE_UfVJoYCMvjHYW1hK7rhXc",
    authDomain: "sharebite-c04fc.firebaseapp.com",
    projectId: "sharebite-c04fc",
    storageBucket: "sharebite-c04fc.appspot.com",
    messagingSenderId: "419532187582",
    appId: "1:419532187582:web:70c35396917e2a2da77bef",
    databaseURL: "https://sharebite-c04fc-default-rtdb.firebaseio.com/",
};

// Initialize Firebase
const app = initializeApp(firebaseConfig);
const auth = getAuth(app);

// Handle the donation form submission
document.getElementById('donationForm')?.addEventListener('submit', async function(event) {
    event.preventDefault(); // Prevent the form from submitting normally

    // Collect form data
    const category = document.getElementById('category').value;
    const foodItem = document.getElementById('food-item').value;
    const geocodeLocation = document.getElementById('geocode-location').value;
    const displayAddress = document.getElementById('address').value;
    const phone = document.getElementById('phone').value;
    const count = document.getElementById('count').value;
    const notes = document.getElementById('notes').value;

    // Get donor email from Firebase Auth
    let donorEmail = '';
    if (auth.currentUser) {
        donorEmail = auth.currentUser.email;
    } else {
        donorEmail = prompt('Please enter your email (required for donation):');
        if (!donorEmail) {
            alert('Email is required to donate.');
            return;
        }
    }

    // Prepare the data to be sent to FastAPI
    const donationData = {
        category: category,
        foodname: foodItem,
        geocode_location: geocodeLocation,
        display_address: displayAddress,
        phone: phone,
        count: parseInt(count, 10),
        note: notes,
        donor_email: donorEmail,
        claimed: false
    };

    try {
        // Send POST request to FastAPI endpoint
        const response = await fetch('https://sharebite-2kfi.onrender.com/donation', {
            method: 'POST',
            headers: {
                'Content-Type': 'application/json'
            },
            body: JSON.stringify(donationData)
        });

        if (response.ok) {
            // Redirect to thank you page
            window.location.href = 'thankyou.html';
        } else {
            const errorData = await response.json();
            alert(`Error: ${errorData.detail || 'Failed to submit donation.'}`);
        }
    } catch (error) {
        console.error('Error submitting donation:', error);
        alert(`Error: ${error.message}`);
    }
});
