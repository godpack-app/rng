import express from 'express';

// Exercise startup configuration without opening a listening socket.
express.application.listen = function listen(port, onReady) {
  process.stdout.write(`PORT=${port}\n`);
  onReady?.();
};

await import('../../src/server.js');
