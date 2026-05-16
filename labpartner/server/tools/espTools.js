import { spawn } from 'child_process';
import { SerialPort } from 'serialport';
import { ReadlineParser } from '@serialport/parser-readline';

/**
 * Run idf.py build in the project directory.
 * Streams each output line via onLine callback.
 * Returns { success, errors[] }
 */
export function buildProject(projectPath, onLine) {
  return new Promise((resolve) => {
    const errors = [];
    const proc = spawn('idf.py', ['build'], {
      cwd: projectPath,
      env: { ...process.env },
    });

    const handleLine = (line) => {
      onLine(line);
      if (line.includes('error:') || line.includes('Error:')) {
        errors.push(line.trim());
      }
    };

    proc.stdout.on('data', (d) => d.toString().split('\n').forEach(handleLine));
    proc.stderr.on('data', (d) => d.toString().split('\n').forEach(handleLine));

    proc.on('close', (code) => {
      resolve({ success: code === 0, errors });
    });
  });
}

/**
 * Run idf.py flash on the given port.
 * Returns { success, error? }
 */
export function flashDevice(projectPath, port) {
  return new Promise((resolve) => {
    const proc = spawn('idf.py', ['-p', port, 'flash'], {
      cwd: projectPath,
      env: { ...process.env },
    });

    let errorOutput = '';
    proc.stderr.on('data', (d) => { errorOutput += d.toString(); });

    proc.on('close', (code) => {
      resolve({
        success: code === 0,
        error: code !== 0 ? errorOutput.slice(-500) : undefined,
      });
    });
  });
}

/**
 * Read from the serial port for `seconds` seconds.
 * Returns array of lines received.
 */

export function readSerial(portPath, seconds = 5) {
  return new Promise((resolve, reject) => {
    const lines = [];

    let port;
    try {
      port = new SerialPort({ path: portPath, baudRate: 115200, autoOpen: true });
    } catch (err) {
      return reject(new Error(`Cannot open serial port ${portPath}: ${err.message}`));
    }

    const parser = port.pipe(new ReadlineParser({ delimiter: '\n' }));
    parser.on('data', (line) => lines.push(line.trim()));

    setTimeout(() => {
      port.close();
      resolve(lines);
    }, seconds * 1000);

    port.on('error', (err) => {
      reject(new Error(`Serial error: ${err.message}`));
    });
  });
}
