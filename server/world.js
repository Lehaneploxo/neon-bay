'use strict';
// The shared city: what's the same for every player on the server (filled in step by step).
function create(o) {
  return {
    joined(p, send) {},
    left(p) {},
    async message(p, m, send, players) {}
  };
}
module.exports = { create };
