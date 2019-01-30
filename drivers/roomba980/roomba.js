'use strict';

const EventEmitter = require('events').EventEmitter;
const mqtt = require('async-mqtt');

const THREE_SECONDS = 3 * 1000;
/**
 * Interface to a Roomba 980.
 * @class Roomba
 */
class Roomba extends EventEmitter {

    /**
     * Set up a new connection to a Roomba 980.
     * @param  {string} username Username to authenticate with.
     * @param  {string} password Password to authenticate with.
     * @param  {string} host     Hostname / IP address of the Roomba.
     * @constructor
     * @memberof Roomba#
     */
    constructor(username, password, host) {
        super();

        try {
            this._client = mqtt.connect(`tls://${host}`, {
                port: 8883,
                clientId: username,
                rejectUnauthorized: false,
                protocolId: 'MQTT',
                protocolVersion: 4,
                clean: false,
                username: username,
                password: password
            });

            this._client.on('error', e => {
                this.emit('error', e);
            });

            this._client.on('connect', () => {
                this.emit('connected');
            });

            this._client.on('offline', () => {
                this.emit('offline');
            });

            this._client.on('packetreceive', packet => {
                if (!packet.payload) return;

                try {
                    const msg = JSON.parse(packet.payload.toString());

                    /*
                    Debounced because sometimes Roombas send a lot of messages in quick succession.
                    The state is kept up to date but only relayed after 3 seconds of radio silence.
                     */
                    if (msg && msg.state && msg.state.reported) {
                        clearTimeout(this.stateEmitDebounce);
                        this._state = Object.assign(this._state || {}, msg.state.reported);
                        this.stateEmitDebounce = setTimeout(() => {
                            this.emit('state', this._state);
                        }, THREE_SECONDS);
                    }
                } catch (e) {
                    console.error(e);
                }
            });
        } catch (e) {
            console.error(e);
        }
    }

    /**
     * Make an API call to the Roobma 980.
     * @param  {string}  topic   Topic of the command.
     * @param  {string}  command The command itself.
     * @return {Promise}         A promise resolving when the command succeeded,
     * or rejecting when it failed.
     */
    async _call(topic, command) {
        let cmd = {
            command,
            time: Date.now() / 1000 | 0,
            initiator: 'localApp'
        };

        if (topic === 'delta') {
            cmd = {
                state: command
            };
        }

        return this._client.publish(topic, JSON.stringify(cmd));
    }

    /**
     * Start cleaning.
     * @method start
     * @memberof Roomba#
     * @return {Promise} A promise resolving when the command succeeded, or
     * rejecting when it failed.
     */
    async start() {
        return this._call('cmd', 'start');
    }

    /**
     * Pause with cleaning.
     * @method pause
     * @memberof Roomba#
     * @return {Promise} A promise resolving when the command succeeded, or
     * rejecting when it failed.
     */
    async pause() {
        return this._call('cmd', 'pause');
    }

    /**
     * Stop cleaning.
     * @method stop
     * @memberof Roomba#
     * @return {Promise} A promise resolving when the command succeeded, or
     * rejecting when it failed.
     */
    async stop() {
        return this._call('cmd', 'stop');
    }

    /**
     * Resume cleaning.
     * @method resume
     * @memberof Roomba#
     * @return {Promise} A promise resolving when the command succeeded, or
     * rejecting when it failed.
     */
    async resume() {
        return this._call('cmd', 'resume');
    }

    /**
     * Go to the dock.
     * @method dock
     * @memberof Roomba#
     * @return {Promise} A promise resolving when the command succeeded, or
     * rejecting when it failed.
     */
    async dock() {
        return this._call('cmd', 'dock');
    }

    /**
     * End the connection with the Roomba 980.
     * @method end
     * @memberof Roomba#
     */
    end() {
        this._client.end(() => {
            if (this._client.stream) {
                this._client.stream.removeAllListeners();
                this._client.stream.end();
            }
        });

        this._client.removeAllListeners();
    }
}

module.exports = Roomba;
