
    // Constants tables
    var RHO_OFFSETS = computeRhoOffsetConstants();
    var PI_INDEXES  = computePiIndexConstants();
    var ROUND_CONSTANTS = computeRoundConstants();

    // Compute Constants
    function computeRhoOffsetConstants() {
      const table = []
        // Compute rho offset constants
        var x = 1, y = 0;
        for (var t = 0; t < 24; t++) {
          table[x + 5 * y] = ((t + 1) * (t + 2) / 2) % 64;

            var newX = y % 5;
            var newY = (2 * x + 3 * y) % 5;
            x = newX;
            y = newY;
        }
        return table
    }

    function computePiIndexConstants() {
      const table = []
        // Compute pi index constants
        for (var x = 0; x < 5; x++) {
            for (var y = 0; y < 5; y++) {
              table[x + 5 * y] = y + ((2 * x + 3 * y) % 5) * 5;
            }
        }
        return table
    }

    function computeRoundConstants() {
      const table = []
        // Compute round constants
        var LFSR = 0x01;
        for (var i = 0; i < 24; i++) {
            var roundConstantMsw = 0;
            var roundConstantLsw = 0;

            for (var j = 0; j < 7; j++) {
                if (LFSR & 0x01) {
                    var bitPosition = (1 << j) - 1;
                    if (bitPosition < 32) {
                        roundConstantLsw ^= 1 << bitPosition;
                    } else /* if (bitPosition >= 32) */ {
                        roundConstantMsw ^= 1 << (bitPosition - 32);
                    }
                }

                // Compute next LFSR
                if (LFSR & 0x80) {
                    // Primitive polynomial over GF(2): x^8 + x^6 + x^5 + x^4 + 1
                    LFSR = (LFSR << 1) ^ 0x71;
                } else {
                    LFSR <<= 1;
                }
            }

            table[i] = X64Word.create(roundConstantMsw, roundConstantLsw);
        }

        return table
    }

    // Reusable objects for temporary values
    var T = createVariableTable();
    function createVariableTable() {
      const table = []
        for (var i = 0; i < 25; i++) {
          table[i] = X64Word.create();
        }
        return table
    }

    let outputLength = 512


        function doReset() {
            var state = this._state = []
            for (var i = 0; i < 25; i++) {
                state[i] = new X64Word.init();
            }

            this.blockSize = (1600 - 2 * outputLength) / 32;
        }

        function doProcessBlock(M, offset) {
            // Shortcuts
            var state = this._state;
            var nBlockSizeLanes = this.blockSize / 2;

            // Absorb
            for (var i = 0; i < nBlockSizeLanes; i++) {
                // Shortcuts
                var M2i  = M[offset + 2 * i];
                var M2i1 = M[offset + 2 * i + 1];

                // Swap endian
                M2i = (
                    (((M2i << 8)  | (M2i >>> 24)) & 0x00ff00ff) |
                    (((M2i << 24) | (M2i >>> 8))  & 0xff00ff00)
                );
                M2i1 = (
                    (((M2i1 << 8)  | (M2i1 >>> 24)) & 0x00ff00ff) |
                    (((M2i1 << 24) | (M2i1 >>> 8))  & 0xff00ff00)
                );

                // Absorb message into state
                var lane = state[i];
                lane.high ^= M2i1;
                lane.low  ^= M2i;
            }

            // Rounds
            for (var round = 0; round < 24; round++) {
                // Theta
                for (var x = 0; x < 5; x++) {
                    // Mix column lanes
                    var tMsw = 0, tLsw = 0;
                    for (var y = 0; y < 5; y++) {
                        var lane = state[x + 5 * y];
                        tMsw ^= lane.high;
                        tLsw ^= lane.low;
                    }

                    // Temporary values
                    var Tx = T[x];
                    Tx.high = tMsw;
                    Tx.low  = tLsw;
                }
                for (var x = 0; x < 5; x++) {
                    // Shortcuts
                    var Tx4 = T[(x + 4) % 5];
                    var Tx1 = T[(x + 1) % 5];
                    var Tx1Msw = Tx1.high;
                    var Tx1Lsw = Tx1.low;

                    // Mix surrounding columns
                    var tMsw = Tx4.high ^ ((Tx1Msw << 1) | (Tx1Lsw >>> 31));
                    var tLsw = Tx4.low  ^ ((Tx1Lsw << 1) | (Tx1Msw >>> 31));
                    for (var y = 0; y < 5; y++) {
                        var lane = state[x + 5 * y];
                        lane.high ^= tMsw;
                        lane.low  ^= tLsw;
                    }
                }

                // Rho Pi
                for (var laneIndex = 1; laneIndex < 25; laneIndex++) {
                    var tMsw;
                    var tLsw;

                    // Shortcuts
                    var lane = state[laneIndex];
                    var laneMsw = lane.high;
                    var laneLsw = lane.low;
                    var rhoOffset = RHO_OFFSETS[laneIndex];

                    // Rotate lanes
                    if (rhoOffset < 32) {
                        tMsw = (laneMsw << rhoOffset) | (laneLsw >>> (32 - rhoOffset));
                        tLsw = (laneLsw << rhoOffset) | (laneMsw >>> (32 - rhoOffset));
                    } else /* if (rhoOffset >= 32) */ {
                        tMsw = (laneLsw << (rhoOffset - 32)) | (laneMsw >>> (64 - rhoOffset));
                        tLsw = (laneMsw << (rhoOffset - 32)) | (laneLsw >>> (64 - rhoOffset));
                    }

                    // Transpose lanes
                    var TPiLane = T[PI_INDEXES[laneIndex]];
                    TPiLane.high = tMsw;
                    TPiLane.low  = tLsw;
                }

                // Rho pi at x = y = 0
                var T0 = T[0];
                var state0 = state[0];
                T0.high = state0.high;
                T0.low  = state0.low;

                // Chi
                for (var x = 0; x < 5; x++) {
                    for (var y = 0; y < 5; y++) {
                        // Shortcuts
                        var laneIndex = x + 5 * y;
                        var lane = state[laneIndex];
                        var TLane = T[laneIndex];
                        var Tx1Lane = T[((x + 1) % 5) + 5 * y];
                        var Tx2Lane = T[((x + 2) % 5) + 5 * y];

                        // Mix rows
                        lane.high = TLane.high ^ (~Tx1Lane.high & Tx2Lane.high);
                        lane.low  = TLane.low  ^ (~Tx1Lane.low  & Tx2Lane.low);
                    }
                }

                // Iota
                var lane = state[0];
                var roundConstant = ROUND_CONSTANTS[round];
                lane.high ^= roundConstant.high;
                lane.low  ^= roundConstant.low;
            }
        }

        function doFinalize() {
            // Shortcuts
            var data = this._data;
            var dataWords = data.words;
            var nBitsTotal = this._nDataBytes * 8;
            var nBitsLeft = data.sigBytes * 8;
            var blockSizeBits = this.blockSize * 32;

            // Add padding
            dataWords[nBitsLeft >>> 5] |= 0x1 << (24 - nBitsLeft % 32);
            dataWords[((Math.ceil((nBitsLeft + 1) / blockSizeBits) * blockSizeBits) >>> 5) - 1] |= 0x80;
            data.sigBytes = dataWords.length * 4;

            // Hash final blocks
            this._process();

            // Shortcuts
            var state = this._state;
            var outputLengthBytes = outputLength / 8;
            var outputLengthLanes = outputLengthBytes / 8;

            // Squeeze
            var hashWords = [];
            for (var i = 0; i < outputLengthLanes; i++) {
                // Shortcuts
                var lane = state[i];
                var laneMsw = lane.high;
                var laneLsw = lane.low;

                // Swap endian
                laneMsw = (
                    (((laneMsw << 8)  | (laneMsw >>> 24)) & 0x00ff00ff) |
                    (((laneMsw << 24) | (laneMsw >>> 8))  & 0xff00ff00)
                );
                laneLsw = (
                    (((laneLsw << 8)  | (laneLsw >>> 24)) & 0x00ff00ff) |
                    (((laneLsw << 24) | (laneLsw >>> 8))  & 0xff00ff00)
                );

                // Squeeze state to retrieve hash
                hashWords.push(laneLsw);
                hashWords.push(laneMsw);
            }

            // Return final computed hash
            return new WordArray.init(hashWords, outputLengthBytes);
        }
