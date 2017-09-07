var io = require("socket.io")(3000);
var fetch = require('node-fetch');

const MAX_BITCOINS = 21*(10**14);

function binIt(n) {
    let x = n + 0.00001; // ceil integers to next bin
    return (x < 5) ?
        Math.ceil(x) :
        (x < 30) ?
            Math.ceil(x / 5) * 5 :
            (x < 60) ?
                Math.ceil(x / 30) * 30 :
                (x < 300) ?
                    Math.ceil(x / 50) * 50 :
                    (x < 500) ?
                        Math.ceil(x / 100) * 100 :
                        (x < 1000) ?
                            Math.ceil(x / 500) * 500 :
                            MAX_BITCOINS;
}

var BINS = {};
for (let x of Array.from(Array(2000)).keys()) {
    BINS[binIt(x)] = null;
}
delete BINS[0];
delete BINS[1];
BINS = Array.from(Object.keys(BINS));

function binMempoolContents(mempoolcontents) {
    let bins = {};
    for (let bin of BINS) {
        bins[bin] = [];
    }
    let size_segwit = 0;
    for (let txid of Object.keys(mempoolcontents)) {
        let tx = mempoolcontents[txid];

        if (tx.wtxid !== txid) {
            size_segwit += 1;
        }

        let sat_b = Math.round(tx.fee*(10**8)/tx.size);
        let bin = binIt(sat_b);

        bins[bin].push([tx.size, tx.fee*(10**8)]);
    };

    let binned = [];
    let prevbin = 1;

    let cum_size = 0;
    let cum_bytes = 0;
    let cum_fees = 0;
    for (let bin of Object.keys(bins)) {
        let intbin = parseInt(bin);
        let transactions = bins[bin];

        let total_size = transactions.length;
        cum_size += total_size;

        let total_bytes = transactions.reduce(
            (sum, tx) => (sum + tx[0])
        , 0);
        cum_bytes += total_bytes;

        let total_fees = transactions.reduce(
            (sum, tx) => (sum + tx[1])
        , 0);
        cum_fees += total_fees;

        binned.push([prevbin, intbin, total_size, total_bytes, total_fees, cum_size, cum_bytes, cum_fees]);
        prevbin = intbin;
    }
    return {
        size: cum_size,
        size_segwit: size_segwit,
        bytes: cum_bytes,
        fees: cum_fees,
        bins: binned.reverse()
    };
}

io.on('connection', function (socket) {
    console.log("client connected");

    socket.emit("hello");

    socket.on('disconnect', function() {
        console.log("client disconnected");
    });

    socket.on("request", function(n, request, params) {
        switch(request) {
            case "block":
            case "block/notxdetails":
                if (params.length !== 64) {
                    console.log(params.length);
                    console.log(`req${n}: ${request}(${params}): invalid, ignoring`);
                    socket.emit("request", n, "error");
                    break;
                }
                // console.log(`req${n}: ${request}(${params}): requesting from bitcoind`);
                // sanity check
                if ((request !== "block") & (request !== "block/notxdetails")) {
                    break;
                }
                fetch(`http://127.0.0.1:8332/rest/${request}/${params}.json`)
                    .then(function(res) {
                        return res.json();
                    }).then(function(block) {
                        console.log(`req${n}: ${request}(${params}): sending response`);

                        delete block.tx; // For now we don't want this.

                        socket.emit(request, block);
                    });
                break;
            case "chaininfo":
                // console.log(`req${n}: ${request}(${params}): requesting from bitcoind`);
                fetch('http://127.0.0.1:8332/rest/chaininfo.json')
                    .then(function(res) {
                        return res.json();
                    }).then(function(json) {
                        console.log(`req${n}: ${request}(${params}): sending response`);

                        // For now we don't care about these.
                        delete json.softforks;
                        delete json.bip9_softforks;

                        socket.emit("chaininfo", json);
                    });
                break;
            /*
            case "getutxos":
                break;
            case "getheaders":
                break;
            */
            case "mempool/contents":
            case "mempool/info":
                // console.log(`req${n}: ${request}(${params}): requesting from bitcoind`);
                // sanity check
                if ((request !== "mempool/contents") & (request !== "mempool/info")) {
                    break;
                }
                fetch(`http://127.0.0.1:8332/rest/${request}/.json`)
                    .then(function(res) {
                        return res.json();
                    }).then(function(json) {
                        console.log(`req${n}: ${request}(${params}): sending response`);
                        socket.emit(request, json);
                    });
                break;
            case "mempool/bins":
                // console.log(`req${n}: ${request}(${params}): requesting from bitcoind`);
                // sanity check
                fetch(`http://127.0.0.1:8332/rest/mempool/contents/.json`)
                    .then(function(res) {
                        return res.json();
                    }).then(function(json) {
                        return binMempoolContents(json);
                    }).then(function(binned) {
                        console.log(`req${n}: ${request}(${params}): sending response`);
                        socket.emit(request, binned);
                    });
                break;
            default:
                console.log(`req${n}: ${request}(${params}): invalid, ignoring`);
                socket.emit("request", n, "error");
        }
    });

});
