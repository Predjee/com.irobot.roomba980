'use strict';

const Homey = require('homey');

const dorita980 = require('dorita980');

class Roomba980Device extends Homey.Device {
    onInit() {
        this.log('roomba980 init');

        let data = this.getData();
        
        try {
            this.robot = new dorita980.Local(data.auth.username, data.auth.password, data.ip);
        } catch (e) {
            this.setUnavailable();
        }


        this.robot.on('connect', () => {
            this.log('connect -> I\'m available now.');
            this.setAvailable();
        });

        this.robot.on('close', () => {
            this.log('close -> I\'m unavailable now.');
            this.setUnavailable();
        });

        this.robot.on('offline', () => {
            this.log('offline -> I\'m unavailable now.');
            this.setUnavailable();
        });

        this.robot.on('state', (e) => {
            this.log('robot state=', e.cleanMissionStatus.cycle, e.cleanMissionStatus.phase);

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

        this.robot.on('mission', (e) => {
            //this.log('robot mission=', e);
        });

        this.registerCapabilityListener('vacuumcleaner_state', this.onVacuumCapabilityChanged);
    }

    getRobot() {
        return this.robot;
    }

    onVacuumCapabilityChanged(e) {
        this.log('vacuum=', e);
    }

    getRobot() {
        return this.robot;
    }

    onAdded() {
        this.log('roomba980 added');
    }

    onDeleted() {
        this.log('roomba980 deleted');

        this.robot.end();
    }
}

module.exports = Roomba980Device;
