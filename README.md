# Roomba

This app adds support for the Roomba vacuum cleaners to Homey.

While the only officially supported device is the Roomba 980, the app seems to work with quite a lot of other Roomba vacuum cleaners.

What works:

 * Starting or stopping the Roomba
 * Sending the Roomba to the dock
 * Checking on your Roomba's status in the mobile app or in the Devices overview

What does not work:

 * Spot cleaning: The Roomba only supports Spot Cleaning by pressing the button.
   There is no known possibility of remotely starting Spot Cleaning.

## Version history
 * 2.0.3: Fixed a bug which could result in not discovering a Roomba 
 * 2.0.2: Fixed memory leak caused by reconnection logic
 * 2.0.1: Added debouncing logic to Roomba state reports, this should fix issues where the Roomba looped through all states in Homey.
 * 2.0.0: Restructure of the application, this should improve overall stability
 * 1.0.4: Updated compatibility value to ensure compatibility with future Homey updates
 * 1.0.1: Added support for multiple Roombas, fixed some bugs.
 * 1.0.0: Initial release
