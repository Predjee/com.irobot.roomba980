'use strict';

const Homey = require('homey');

const dorita980 = require('dorita980');

const RoombaFinder = require('./finder');

class Roomba980Device extends Homey.Device {
    onInit() {
        this.log('roomba980 init');

        this.data = this.getData();

        this.connected = false;

        this.robot = null;

        this.finder = new RoombaFinder();

        this.setUnavailable(Homey.__('error.offline'));

        this.registerCapabilityListener('vacuumcleaner_state', this.onVacuumCapabilityChanged.bind(this));

        this.findRobot();

        this.reconnectInterval = setInterval(() => {
            if (!this.connected) {
                this.log('Trying to find the Roomba.');
                this.findRobot();
            }
        }, 15000);
    }

    findRobot() {
        this.connected = false;

        delete this.robot;

        this.setUnavailable(Homey.__('error.offline'));

        this.finder.findRoomba()
            .then((robot) => {
                if (robot.mac !== this.data.mac) {
                    this.log(`Found robot MAC (${robot.mac}) is not what we wanted (${this.data.mac})`);
                    return;
                }

                this.log(`Found a robot with ${robot.mac} and ${robot.ip}.`);
                this.log(`Logging in with ${this.data.auth.username} / ${this.data.auth.password}.`);

                let robotInstanceId = Math.random();

                try {
                    this.robot = new dorita980.Local(this.data.auth.username, this.data.auth.password, robot.ip);
                } catch (e) {
                    this.setUnavailable();

                    this.connected = false;

                    delete this.robot;

                    return;
                }

                this.robot.on('connect', () => {
                    this.log(robotInstanceId + ' connect -> I\'m available now.');

                    this.connected = true;

                    this.setAvailable();
                });

                this.robot.on('close', () => {
                    this.log(robotInstanceId + 'close -> I\'m unavailable now.');

                    this.connected = false;

                    this.disconnectFromRobot();

                    this.setUnavailable(Homey.__('error.offline'));
                });

                this.robot.on('offline', () => {
                    this.log(robotInstanceId + 'offline -> I\'m unavailable now.');

                    this.connected = false;

                    this.disconnectFromRobot();

                    this.setUnavailable(Homey.__('error.offline'));
                });

                this.robot.on('state', (e) => {
                    this.log(robotInstanceId + 'robot state=', e.cleanMissionStatus.cycle, e.cleanMissionStatus.phase);

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
            })
            .catch((e) => {
                this.log('Could not find any robot: ', e);
            });
    }

    getRobot() {
        return this.robot;
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

    onAdded() {
        this.log('roomba980 added');
    }

    onDeleted() {
        this.log('roomba980 deleted');

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
