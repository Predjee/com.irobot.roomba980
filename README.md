# Roomba

This app adds support for the Roomba (WiFi) vacuum cleaners and the Braava M6 to Homey.

Supported functionality:

 * Starting or stopping the Roomba/Braava
 * Sending the Roomba/Braava to the dock
 * Checking the battery status
 * Checking the current cleaning activity
 * Checking the state of the bin of Roomba
 * Checking the state of the watertank of the Braava
 * Checking the state of the pad of the Braava

Unsupported functionality:

 * Spot cleaning: the Roomba only supports Spot Cleaning by pressing the button.
   It is not possible to remotely start Spot Cleaning.


Future support wishes:
 * Getting cleaning scheme insights as card trigger
 * Adding support for smart cleaning (only map part a, b, c)
 * Trigger cleaning based on conditions

## Version history
 * 4.0.0: Updated code base to become compatible with SDK 3
 * 3.0.0: Updated code base added wider support of roomba's (untested multiple devices only tested the 960 and 980), added the braava m6
 * 2.0.4: Updated code base
 * 2.0.3: Fixed a bug which could result in not discovering a Roomba
 * 2.0.2: Fixed memory leak caused by reconnection logic
 * 2.0.1: Added debouncing logic to Roomba state reports, this should fix issues where the Roomba looped through all states in Homey.
 * 2.0.0: Restructure of the application, this should improve overall stability
 * 1.0.4: Updated compatibility value to ensure compatibility with future Homey updates
 * 1.0.1: Added support for multiple Roombas, fixed some bugs.
 * 1.0.0: Initial release
