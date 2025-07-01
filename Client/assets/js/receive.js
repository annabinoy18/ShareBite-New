// assets/js/receive.js

document.addEventListener('DOMContentLoaded', () => {
    // 1. Get the user's location.
    if (navigator.geolocation) {
        navigator.geolocation.getCurrentPosition(onLocationSuccess, onLocationError);
    } else {
        alert("Geolocation is not supported by this browser.");
        // Display a message if geolocation is not available
        const listElement = document.getElementById('donations-list');
        if (listElement) {
            listElement.innerHTML = '<p>Geolocation is not supported by your browser. Cannot display nearby donations.</p>';
        }
    }

    // Initialize modal logic
    initializeClaimModal();

    // Add event listeners for both filters
    document.getElementById('search-bar')?.addEventListener('input', applyFilters);
    document.getElementById('category-filter')?.addEventListener('change', applyFilters);
});

function applyFilters() {
    const searchQuery = document.getElementById('search-bar').value.toLowerCase();
    const categoryQuery = document.getElementById('category-filter').value;
    const donationCards = document.querySelectorAll('.donor-card');

    donationCards.forEach(card => {
        const foodName = card.querySelector('h3').textContent.toLowerCase();
        const category = card.dataset.category.toLowerCase();

        const matchesSearch = foodName.includes(searchQuery);
        const matchesCategory = (categoryQuery === 'all') || (category === categoryQuery);

        if (matchesSearch && matchesCategory) {
            card.style.display = 'block';
        } else {
            card.style.display = 'none';
        }
    });
}

// Function to handle successful location retrieval
async function onLocationSuccess(position) {
    const receiverLat = position.coords.latitude;
    const receiverLon = position.coords.longitude;

    try {
        // 2. Fetch all unclaimed donations from the backend endpoint.
        const response = await fetch('https://sharebite-2kfi.onrender.com/donations');
        if (!response.ok) {
            throw new Error(`HTTP error! status: ${response.status}`);
        }
        let donations = await response.json();

        // Log the received data to the console for debugging
        console.log('Donations received from backend:', donations);

        // 3. Calculate distance for each donation.
        donations.forEach(donation => {
            if (donation.latitude && donation.longitude) {
                donation.distance = calculateDistance(receiverLat, receiverLon, donation.latitude, donation.longitude);
            } else {
                donation.distance = Infinity; // Place donations without coordinates at the end.
            }
        });

        // 4. Sort donations by distance (nearest first).
        donations.sort((a, b) => a.distance - b.distance);

        // 5. Display the sorted donations in the list and on the map.
        displayDonationsList(donations);
        displayDonationsMap(receiverLat, receiverLon, donations);

    } catch (error) {
        console.error("Failed to fetch or process donations:", error);
        const listElement = document.getElementById('donations-list');
        listElement.innerHTML = '<p>Could not load donations. Please try again later.</p>';
    }
}

// Function to handle location retrieval errors
function onLocationError(error) {
    alert(`Could not get your location: ${error.message}`);
    const listElement = document.getElementById('donations-list');
    listElement.innerHTML = '<p>Cannot show donations without your location. Please allow location access.</p>';
}

// Helper function to calculate distance using the Haversine formula
function calculateDistance(lat1, lon1, lat2, lon2) {
    const R = 6371; // Radius of the Earth in km
    const dLat = (lat2 - lat1) * Math.PI / 180;
    const dLon = (lon2 - lon1) * Math.PI / 180;
    const a =
        Math.sin(dLat / 2) * Math.sin(dLat / 2) +
        Math.cos(lat1 * Math.PI / 180) * Math.cos(lat2 * Math.PI / 180) *
        Math.sin(dLon / 2) * Math.sin(dLon / 2);
    const c = 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1 - a));
    return R * c; // Returns distance in km
}

// Function to display donations in a list format
function displayDonationsList(donations) {
    const listElement = document.getElementById('donations-list');
    listElement.innerHTML = ''; // Clear any previous content

    if (donations.length === 0) {
        listElement.innerHTML = '<p>No donations available right now. Check back later!</p>';
        return;
    }

    donations.forEach(donation => {
        const item = document.createElement('div');
        item.className = 'donor-card'; // Use existing class for styling
        item.dataset.category = donation.category; // Store category for filtering
        item.innerHTML = `
            <h3>${donation.foodname} (${donation.category})</h3>
            <p><strong>Address:</strong> ${donation.display_address}</p>
            <p><strong>Area:</strong> ${donation.geocode_location}</p>
            <p><strong>Distance:</strong> ${donation.distance === Infinity ? 'Not available' : donation.distance.toFixed(2) + ' km away'}</p>
            <p><strong>Serves:</strong> ${donation.count} people</p>
            <p><strong>Notes:</strong> ${donation.note || 'No notes provided'}</p>
            <p><strong>Contact:</strong> ${donation.phone}</p>
            <button class="claim-btn" data-id="${donation.id}">Claim Donation</button>
        `;
        listElement.appendChild(item);
    });

    // Add event listeners to all newly created "Claim" buttons
    listElement.querySelectorAll('.claim-btn').forEach(button => {
        button.addEventListener('click', (event) => {
            const donationId = event.target.getAttribute('data-id');
            const card = event.target.closest('.donor-card');
            showClaimModal(donationId, card);
        });
    });
}

// Function to display donations on a Leaflet map
function displayDonationsMap(receiverLat, receiverLon, donations) {
    // Define custom icons for markers
    const blueIcon = new L.Icon({
        iconUrl: 'https://raw.githubusercontent.com/pointhi/leaflet-color-markers/master/img/marker-icon-2x-blue.png',
        shadowUrl: 'https://cdnjs.cloudflare.com/ajax/libs/leaflet/0.7.7/images/marker-shadow.png',
        iconSize: [25, 41],
        iconAnchor: [12, 41],
        popupAnchor: [1, -34],
        shadowSize: [41, 41]
    });

    const redIcon = new L.Icon({
        iconUrl: 'https://raw.githubusercontent.com/pointhi/leaflet-color-markers/master/img/marker-icon-2x-red.png',
        shadowUrl: 'https://cdnjs.cloudflare.com/ajax/libs/leaflet/0.7.7/images/marker-shadow.png',
        iconSize: [25, 41],
        iconAnchor: [12, 41],
        popupAnchor: [1, -34],
        shadowSize: [41, 41]
    });
    
    // Check if map already initialized to prevent errors
    const mapContainer = document.getElementById('map');
    if (mapContainer && mapContainer._leaflet_id) {
        mapContainer.innerHTML = "";
    }

    const map = L.map('map').setView([receiverLat, receiverLon], 12);

    L.tileLayer('https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png', {
        attribution: '&copy; <a href="https://www.openstreetmap.org/copyright">OpenStreetMap</a> contributors'
    }).addTo(map);

    // Marker for the receiver's location
    L.marker([receiverLat, receiverLon], { icon: blueIcon }).addTo(map)
        .bindPopup('<strong>Your Location</strong>')
        .openPopup();

    // Markers for each donation
    donations.forEach(donation => {
        if (donation.latitude && donation.longitude) {
            L.marker([donation.latitude, donation.longitude], { icon: redIcon }).addTo(map)
                .bindPopup(
                    `<b>${donation.foodname}</b><br>` +
                    `Address: ${donation.display_address}<br>` +
                    `Serves: ${donation.count}<br>` +
                    `Distance: ${donation.distance.toFixed(2)} km`
                );
        }
    });
}

// Modal handling logic, integrated from the original script
let currentCard = null;
function initializeClaimModal() {
    const claimModal = document.getElementById('claim-modal');
    const closeModal = document.getElementById('close-modal');
    const claimForm = document.getElementById('claim-form');

    closeModal?.addEventListener('click', hideClaimModal);
    window.onclick = function(event) {
        if (event.target === claimModal) {
            hideClaimModal();
        }
    };

    claimForm?.addEventListener('submit', async function(event) {
        event.preventDefault();
        const claimDonationIdInput = document.getElementById('claim-donation-id');
        const donationId = claimDonationIdInput.value;
        const receiverName = document.getElementById('receiver-name').value;
        const receiverEmail = document.getElementById('receiver-email').value;
        const receiverPhone = document.getElementById('receiver-phone').value;

        try {
            const response = await fetch('https://sharebite-2kfi.onrender.com/claim_donation', {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({
                    donation_id: donationId,
                    receiver_name: receiverName,
                    receiver_email: receiverEmail,
                    receiver_phone: receiverPhone
                })
            });

            if (response.ok) {
                // Remove the card from the UI after successful claim
                if (currentCard) {
                    currentCard.remove();
                }
                alert('Donation claimed successfully! You will receive an email with further instructions.');
                hideClaimModal();
            } else {
                const errorData = await response.json();
                alert(`Error: ${errorData.detail || 'Failed to claim donation.'}`);
            }
        } catch (error) {
            alert('Error: ' + error.message);
        }
    });
}

function showClaimModal(donationId, card) {
    const claimModal = document.getElementById('claim-modal');
    const claimDonationIdInput = document.getElementById('claim-donation-id');
    
    claimDonationIdInput.value = donationId;
    claimModal.style.display = 'block';
    currentCard = card;
}

function hideClaimModal() {
    const claimModal = document.getElementById('claim-modal');
    const claimForm = document.getElementById('claim-form');

    claimModal.style.display = 'none';
    if(claimForm) claimForm.reset();
    currentCard = null;
}