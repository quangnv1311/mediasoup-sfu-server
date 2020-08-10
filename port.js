const MIN_PORT = 20000;
const MAX_PORT = 30000;

const takenPortSet = new Set();

module.exports.getPort = async () => {
    let port = getRandomPort();

    while (takenPortSet.has(port)) {
        port = getRandomPort();

        try {
            // Check that the port is available to use
            await isPortOpen(port);
        } catch (error) {
            console.error('getPort() port is taken [port:%d]', port);
            takenPortSet.add(port);
        }
    }

    takenPortSet.add(port);

    return port;
};

module.exports.releasePort = (port) => takenPortSet.delete(port);

const getRandomPort = () => Math.floor(Math.random() * (MAX_PORT - MIN_PORT + 1) + MIN_PORT);

// Users a net to check that the port is open
const isPortOpen = (port) => {
    const net = require('net');
    const server = net.createServer();
    return new Promise((resolve, reject) => {
        server.listen(port).once('connection', resolve());
        server.listen(port).once('close', () => reject());
        server.listen(port).once('listening', () => reject());
        server.listen(port).once('error', () => reject());
    });
};