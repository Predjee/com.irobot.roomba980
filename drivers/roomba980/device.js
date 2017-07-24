'use strict';

const Homey = require('homey');

const dorita980 = require('dorita980');

const RoombaFinder = require('./finder');

class Roomba980Device extends Homey.Device {
    onInit() {
        this.data = this.getData();

        this.connected = false;

        this.robot = null;

        this.finder = new RoombaFinder();

        this.setUnavailable(Homey.__('error.offline'));

        this.registerCapabilityListener('vacuumcleaner_state', this.onVacuumCapabilityChanged.bind(this));

        this.findRobot();

        this.reconnectInterval = setInterval(() => {
            if (!this.connected) {
                this.findRobot();
            }
        }, 15000);
    }

    /**
     * Attempts to find the Roomba and connect to it. Also adds event listeners.
     *
     * This method searches for any existing Roomba on the network and compares
     * their MAC addresses. If it is the one we want (stored in device data), we
     * connect to it.
     */
    findRobot() {
        this.connected = false;

        delete this.robot;

        this.setUnavailable(Homey.__('error.offline'));

        this.finder.findRoomba()
            .then((robot) => {
                if (robot.mac !== this.data.mac) {
                    return;
                }

                try {
                    this.robot = new dorita980.Local(this.data.auth.username, this.data.auth.password, robot.ip);
                } catch (e) {
                    this.setUnavailable();

                    this.connected = false;

                    delete this.robot;

                    return;
                }

                this.robot.on('connect', () => {
                    this.connected = true;

                    this.setAvailable();
                });

                this.robot.on('close', () => {
                    this.connected = false;

                    this.disconnectFromRobot();

                    this.setUnavailable(Homey.__('error.offline'));
                });

                this.robot.on('offline', () => {
                    this.connected = false;

                    this.disconnectFromRobot();

                    this.setUnavailable(Homey.__('error.offline'));
                });

                this.robot.on('state', (e) => {
                    this.setCapabilityValue('measure_battery', e.batPct);

                    let cycle = e.cleanMissionStatus.cycle,
                        phase = e.cleanMissionStatus.phase;

                    if (cycle === 'none' && phase === 'charge') {
                        this.setCapabilityValue('vacuumcleaner_state', 'charging');
                    }

                    if (cycle === 'none' && phase === 'stop') {
                        this.setCapabilityValue('vacuumcleaner_state', 'stopped');
                    }

                    if (cycle === 'dock' && phase === 'hmUsrDock') {
                        this.setCapabilityValue('vacuumcleaner_state', 'docked');
                    }

                    if (cycle === 'quick' && phase === 'stop') {
                        this.setCapabilityValue('vacuumcleaner_state', 'stopped');
                    }

                    if (cycle === 'quick' && phase === 'run') {
                        this.setCapabilityValue('vacuumcleaner_state', 'cleaning');
                    }

                    if (cycle === 'spot' && phase === 'run') {
                        this.setCapabilityValue('vacuumcleaner_state', 'spot_cleaning');
                    }
                });
            });
    }

    onVacuumCapabilityChanged(value) {
        switch (value) {
        case 'cleaning':
            return this.robot.start();
        case 'spot_cleaning':
            return Promise.reject(new Error(Homey.__('error.spot_cleaning')));
        case 'docked':
        case 'charging':
            return this.robot.dock();
        case 'stopped':
            return this.robot.stop();
        }
    }

    onDeleted() {
        clearInterval(this.reconnectInterval);

        this.disconnectFromRobot();
    }

    disconnectFromRobot() {
        this.robot.end(true, () => {
            this.robot.removeAllListeners();
            delete this.robot;
        });
    }
}

module.exports = Roomba980Device;
