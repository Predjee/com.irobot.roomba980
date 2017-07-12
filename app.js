'use strict';

const Homey = require('homey');

class Roomba980 extends Homey.App {
    onInit() {
        let startVacuumAction = new Homey.FlowCardAction('start_vacuum');

        startVacuumAction
            .register()
            .on('run', (args, state, callback) => {
                args.device.getRobot().start()
                    .then(() => {
                        callback(null, true);
                    })
                    .catch((e) => {
                        callback(e);
                    });
            });

        let stopVacuumAction = new Homey.FlowCardAction('stop_vacuum');

        stopVacuumAction
            .register()
            .on('run', (args, state, callback) => {
                args.device.getRobot().stop()
                    .then(() => {
                        callback(null, true);
                    })
                    .catch((e) => {
                        callback(e);
                    });
            });

        let dockAction = new Homey.FlowCardAction('dock');

        dockAction
            .register()
            .on('run', (args, state, callback) => {
                args.device.getRobot().dock()
                    .then(() => {
                        callback(null, true);
                    })
                    .catch((e) => {
                        callback(e);
                    });
            });
    }
}

module.exports = Roomba980;
