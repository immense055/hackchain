'use strict';

const assert = require('assert');
const async = require('async');
const crypto = require('crypto');
const Buffer = require('buffer').Buffer;
const BN = require('bn.js');
const WBuf = require('wbuf');
const OBuf = require('obuf');

const hackchain = require('../');
const TX = hackchain.TX;
const Block = hackchain.Block;
const Chain = hackchain.Chain;

const fixtures = require('./fixtures');

describe('Chain', () => {
  let chain;

  beforeEach((done) => {
    fixtures.removeDB();

    chain = new Chain(fixtures.dbPath, {
      workers: 1
    });
    chain.init(done);
  });

  afterEach((done) => {
    chain.close(() => {
      fixtures.removeDB();
      done();
    });

    chain = null;
  });

  it('should store/load block', (done) => {
    const b = new Block(hackchain.constants.empty);

    chain.storeBlock(b, (err) => {
      assert.deepEqual(err, null);

      chain.getBlock(b.hash().toString('hex'), (err, block) => {
        assert.deepEqual(err, null);

        assert.deepEqual(block, b);
        done();
      });
    });
  });

  it('should store/load tx', (done) => {
    const tx = new TX();

    chain.storeTX(tx, (err) => {
      assert.deepEqual(err, null);

      chain.getTX(tx.hash().toString('hex'), (err, tx2) => {
        assert.deepEqual(err, null);

        assert.deepEqual(tx2, tx);
        done();
      });
    });
  });

  it('should verify coinbase-only block', (done) => {
    const block = new Block(hackchain.constants.genesis);
    const tx = new TX();

    tx.input(hackchain.constants.empty, 0, new TX.Script());
    tx.output(hackchain.constants.coinbase, new TX.Script());
    block.addCoinbase(tx);

    async.waterfall([
      (callback) => {
        chain.storeBlock(block, callback);
      },
      (callback) => {
        block.verify(chain, (err, result) => {
          assert.deepEqual(err, null);
          assert.deepEqual(result, true);
          callback(null);
        });
      },
      (callback) => {
        chain.getTXBlock(tx.hash(), (err, txBlock) => {
          assert.deepEqual(err, null);
          assert.deepEqual(txBlock, block.hash());

          callback(null);
        });
      },
      (callback) => {
        chain.getTXSpentBy(tx.inputs[0].hash, 0, (err, spentBy) => {
          assert.deepEqual(err, null);
          assert.deepEqual(spentBy, tx.hash());

          callback(null);
        });
      }
    ], done);
  });

  it('should report unspent TXs', (done) => {
    const block = new Block(hackchain.constants.genesis);
    const tx = new TX();

    tx.input(hackchain.constants.empty, 0, new TX.Script());
    tx.output(hackchain.constants.coinbase, new TX.Script());
    block.addCoinbase(tx);

    async.waterfall([
      (callback) => {
        chain.storeBlock(block, callback);
      },
      (callback) => {
        chain.getUnspentTXs(10, callback);
      },
      (txs, callback) => {
        assert.equal(txs.length, 1);
        assert.deepEqual(txs[0].hash, tx.hash());
        assert.equal(txs[0].index, 0);
        assert.equal(txs[0].value.toString(10),
                     hackchain.constants.coinbase.toString(10));

        callback(null);
      }
    ], done);
  });

  it('should fail to verify block without parent', (done) => {
    const block = new Block(hackchain.constants.empty);

    async.parallel([
      (callback) => {
        chain.storeBlock(block, callback);
      }
    ], (err) => {
      if (err)
        return callback(err);

      block.verify(chain, (err, result) => {
        assert(err);
        assert.deepEqual(result, false);

        done();
      });
    });
  });

  it('should fail to verify block without coinbase', (done) => {
    const block = new Block(hackchain.constants.genesis);

    async.parallel([
      (callback) => {
        chain.storeBlock(block, callback);
      }
    ], (err) => {
      if (err)
        return callback(err);

      block.verify(chain, (err, result) => {
        assert(err);
        assert.deepEqual(result, false);

        done();
      });
    });
  });

  it('should fail to verify tx with negative fee', (done) => {
    const b1 = new Block(hackchain.constants.genesis);

    const coinbase = new TX();
    coinbase.input(hackchain.constants.empty, 0, new TX.Script());
    coinbase.output(hackchain.constants.coinbase,
                    new TX.Script(hackchain.constants.coinbaseScript));
    b1.addCoinbase(coinbase);

    const b2 = new Block(b1.hash());

    {
      const tx = new TX();
      tx.input(hackchain.constants.empty, 0, new TX.Script());
      tx.output(new BN(0), new TX.Script());
      b2.addCoinbase(tx);
    }

    {
      const tx = new TX();
      tx.input(coinbase.hash(), 0, new TX.Script());
      tx.output(hackchain.constants.coinbase.addn(1), new TX.Script());
      b2.addTX(tx);
    }

    async.forEachSeries([ b1, b2 ], (block, callback) => {
      chain.storeBlock(block, callback);
    }, (err) => {
      if (err)
        return callback(err);

      b2.verify(chain, (err, result) => {
        assert(/Negative fee/.test(err.message));
        assert.deepEqual(result, false);

        done();
      });
    });
  });

  it('should fail to verify tx with non-existent input', (done) => {
    const block = new Block(hackchain.constants.genesis);

    const coinbase = new TX();
    coinbase.input(hackchain.constants.empty, 0, new TX.Script());
    coinbase.output(new BN(hackchain.constants.coinbase), new TX.Script());
    block.addCoinbase(coinbase);

    const fake = new TX();
    fake.output(new BN(1), new TX.Script());

    const tx = new TX();
    tx.input(fake.hash(), 0, new TX.Script());
    tx.output(new BN(1), new TX.Script());
    block.addTX(tx);

    async.parallel([
      (callback) => {
        chain.storeBlock(block, callback);
      }
    ], (err) => {
      if (err)
        return callback(err);

      block.verify(chain, (err, result) => {
        assert(/Key not found in database/.test(err.message));
        assert.deepEqual(result, false);

        done();
      });
    });
  });
});
