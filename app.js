'use strict';

const Homey = require('homey');

class IRobot extends Homey.App {
  onInit() {
    this.log(`${this.id} running...`);
  }
}

module.exports = IRobot;
