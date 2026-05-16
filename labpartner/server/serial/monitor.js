import { SerialPort } from 'serialport';
import { ReadlineParser } from '@serialport/parser-readline';
import { EventEmitter } from 'events';

/**
 * SerialMonitor: a persistent, event-emitting serial stream.
 * Used for the live serial feed on the dashboard (independent of the agent loop).
 *
 * Usage:
 *   const mon = new SerialMonitor('/dev/ttyUSB0', 115200);
 *   mon.on('data', line => wsSend({ type: 'SERIAL_LINE', data: line }));
 *   mon.open();
 *   // later:
 *   mon.close();
 */
export class SerialMonitor extends EventEmitter {
  constructor(portPath, baudRate = 115200) {
    super();
    this.portPath = portPath;
    this.baudRate = baudRate;
    this.port = null;
    this.parser = null;
  }

  open() {
    this.port = new SerialPort({
      path: this.portPath,
      baudRate: this.baudRate,
      autoOpen: true,
    });

    this.parser = this.port.pipe(new ReadlineParser({ delimiter: '\n' }));

    this.parser.on('data', (line) => {
      this.emit('data', line.trim());
    });

    this.port.on('error', (err) => {
      this.emit('error', err.message);
    });

    this.port.on('open', () => {
      this.emit('open', this.portPath);
    });
  }

  close() {
    if (this.port && this.port.isOpen) {
      this.port.close();
    }
    this.port = null;
    this.parser = null;
  }

  isOpen() {
    return this.port?.isOpen ?? false;
  }
}
