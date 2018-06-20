'use strict';

const Homey = require('homey');

const Roomba = require('./roomba');

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

        this._reconnect();
    }

    _reconnect() {
        this.reconnectInterval = setInterval(() => {
            if (!this.connected) {
                this.log('Connection was lost, finding new robots.');

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

        this.finder.roombas.forEach((robot) => {
            this.log(`Found a Roomba: ${robot.ip}.`);

            if (robot.mac !== this.data.mac) {
                return;
            }

            this.robot = new Roomba(this.data.auth.username, this.data.auth.password, robot.ip);

            this.robot.on('connected', () => {
                this.connected = true;

                clearInterval(this.reconnectInterval);

                this.log(`Connected to ${robot.ip}.`);

                this.setAvailable();
            });

            this.robot.on('offline', () => {
                this.connected = false;

                this.log(`Lost connection with ${robot.ip}: offline.`);

                this.disconnectFromRobot();

                this._reconnect();

                this.setUnavailable(Homey.__('error.offline'));
            });

            this.robot.on('error', e => {
                this.error(`Error in Roomba connection: ${e}`);
            });

            this.robot.on('state', (state) => {
                if (typeof state.batPct !== 'undefined') {
                    this.setCapabilityValue('measure_battery', state.batPct)
                        .catch(this.error.bind('measure_battery', state.batPct));
                }

                let cycle = state.cleanMissionStatus.cycle,
                    phase = state.cleanMissionStatus.phase;

                if (cycle === 'none' && phase === 'charge') {
                    if (typeof state.batPct !== 'undefined' && state.batPct < 100) {
                        this.setCapabilityValue('vacuumcleaner_state', 'charging')
                            .catch(this.error.bind(this, 'vacuumcleaner_state charging'));
                    } else {
                        this.setCapabilityValue('vacuumcleaner_state', 'docked')
                            .catch(this.error.bind(this, 'vacuumcleaner_state docked'));
                    }
                } else if (cycle === 'none' || cycle === 'quick') && phase === 'stop') {
                    this.setCapabilityValue('vacuumcleaner_state', 'stopped')
                        .catch(this.error.bind(this, 'vacuumcleaner_state stopped'));
                } else if (cycle === 'dock' && phase === 'hmUsrDock') {
                    this.setCapabilityValue('vacuumcleaner_state', 'docked')
                        .catch(this.error.bind(this, 'vacuumcleaner_state docked'));
                } else if (cycle === 'quick' && phase === 'run') {
                    this.setCapabilityValue('vacuumcleaner_state', 'cleaning')
                        .catch(this.error.bind(this, 'vacuumcleaner_state cleaning'));
                } else if (cycle === 'spot' && phase === 'run') {
                    this.setCapabilityValue('vacuumcleaner_state', 'spot_cleaning')
                        .catch(this.error.bind(this, 'vacuumcleaner_state spot_cleaning'));
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
        this.log('Disconnecting from robot...');

        if (this.robot) {
            this.robot.removeAllListeners();

            this.robot.end();
        }
    }
}

module.exports = Roomba980Device;
