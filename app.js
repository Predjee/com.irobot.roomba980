'use strict';

const Homey = require('homey');

// TODO: add energy properties
// TODO: device does not broadcast state changes when controller via proprietary smartphone app
// TODO: remove spot_cleaning from possible capability values (not controllable via Homey)
class Roomba980 extends Homey.App {
  onInit() {
    this.log(`${this.id} running...`);
  }
}

module.exports = Roomba980;
