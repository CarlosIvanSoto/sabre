## Start: Air Booking
# Step 1: Search flights via Bargain Finder Max ✅
Search for flight options by lowest fare via Bargain Finder Max.

Bargain Finder Max computes a vast array of airline schedules and fares across multiple dates to assemble the best set of itinerary offers within seconds.

# Step 2: Revalidate itinerary pricing
Revalidate the availability and pricing for a specific itinerary option with Revalidate Itinerary (without actually booking a flight).

This API can also be used to request additional information about rules, flight details, and seating, including upselling to other options.
# Step 3: Get Seats service (optional)
Seat availability display via the Get Seats service.

This is an optional step and depending on your workflow needs can be executed prior to or post booking creation.
# Step 4: Get Ancillaries service (optional)
Ancillary availability display via the Get Ancillaries service.

This API provides details on both chargeable (e.g., bags) and free (e.g., wheelchair) ancillary services offered for a given flight/trip. This is an optional step and depending on your workflow needs can be executed prior to or post booking creation.
# Step 5: Create Booking via Booking Management API
Generate an entire reservation (PNR or Order) within a single API by using the Booking Management API (specifically via the /createBooking endpoint).

This API books all flights, prices and stores fares, and adds all necessary data/special requests (if any) within a single API call. Upon successful execution, the API will return the Sabre confirmation Id for the newly created booking as well as the airline(s) confirmation Id(s).
# End: Booking confirmed with Sabre and airline IDs
