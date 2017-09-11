// TODO: base API_URL on actual URI in browser
const API_URL = "https://esotericnonsense.com/api"
const ALL_BITCOINS = 21*(10**14);
const INITIAL_RANGE = 30;

var formatBytes = function(a,b){if(0==a)return"zero";var c=1024,d=b||2,e=["B","KiB","MiB"],f=Math.floor(Math.log(a)/Math.log(c));return parseFloat((a/Math.pow(c,f)).toFixed(d))+" "+e[f]};

var getDateEpoch = function(d) {
    return (d.getTime() / 1000);
}
var getCurrentTime = function() {
    return getDateEpoch(new Date());
};
var getCurrentTimeUTC = function() {
    let now = new Date();
    return Math.floor((now.getTime() + now.getTimezoneOffset() * 60000)/1000);
};

var asyncRequest = function(request, callback) {
    var xhr = new XMLHttpRequest();
    xhr.open("GET", `${API_URL}/${request}`, true);
    xhr.onload = function(e) {
        if (xhr.readyState === 4) {
            if (xhr.status === 200) {
                let j = JSON.parse(xhr.responseText);
                callback(request, j);
            } else {
                // console.error(xhr.statusText);
            }
        }
    };
    xhr.onerror = function(e) {
        // console.error(xhr.statusText);
    };
    xhr.send(null);
}

onload = function() {
    el_out = document.getElementById("output");

    var app = new Vue({
        el: '#app',
        data: {
            connected: false,
            now: getCurrentTime(),
            lastpong: new Date(0),
            last_updated: new Date(0),
            chaininfo: null,
            mempoolbins: null,
            range: 0,
            blocks: {},
        },
        filters: {
            pretty: function(json) {
                return JSON.stringify(json, null, 2);
            },
            timeInterval: function(timeinterval) {
                let h = Math.floor(timeinterval / 3600);
                let m = Math.floor((timeinterval / 60) % 60);
                let s = Math.floor(timeinterval % 60);
                if (h) {
                    return `${h} h ${m} min`;
                } else if (m) {
                    return `${m} min ${s} sec`;
                } else {
                    return `${s} sec`;
                }
            },
            formatBin: function(bin) {
            }
        },
        computed: {
            sortedBlocks: function() {
                let l = [];
                for (let hash of Object.keys(this.blocks)) {
                    l.push(this.blocks[hash]);
                };
                l.sort(function(a, b) {
                    let x = a.height; let y = b.height;
                    return ((x > y) ? -1 : ((x < y) ? 1 : 0));
                });
                return l;
            },
        },
        methods: {
            getBlockIfRequired: function(hash) {
                if (hash in app.blocks) {
                    return;
                }

                asyncRequest(`block/notxdetails/${hash}`, processAsyncResponse);
            },
            setRange: function(range) {
                if (range === app.range) {
                    return;
                }

                COLUMNS = null;

                // when the response comes in the graph will reset.
                clearBinInterval();
                setBinInterval(range);
            }
        },
    })

    setInterval(function() {
        app.now = getCurrentTime();
        if (((app.now - app.lastpong) > 10) && (app.connected)) {
            onDisconnect();
        }
    }, 1000);

    setInterval(function() {
        asyncRequest(`ping`, processAsyncResponse);

        if (!app.connected) {
            return;
        }
        asyncRequest(`chaininfo`, processAsyncResponse);
    }, 5000);

    let bin_interval = 0;

    let clearBinInterval = function() {
        clearInterval(bin_interval);
        bin_interval = 0;
    }

    let setBinInterval = function(range) {
        if (bin_interval !== 0) {
            // should never happen
            return;
        }

        bin_interval = setInterval(function() {
            if (!app.connected) {
                return;
            }

            asyncRequest(`mempool/bins`, processAsyncResponse);
        }, range*60000/120);

        app.range = range;
        app.last_updated = app.now; // makes next update appear cleanly

        asyncRequest(`mempool/bins/range/${range}`, processAsyncResponse);
    }

    let dealWithChaininfo = function(chaininfo) {
        app.chaininfo = chaininfo;
        app.getBlockIfRequired(chaininfo.bestblockhash);
    };

    var CHART = null;
    var COLUMNS = null;

    let dealWithMempoolBins = function(mempoolbins, redraw=true) {
        app.last_updated = app.now;

        let getLabel = function(n) {
            if (n === ALL_BITCOINS) {
                return "max";
            }
            return `< ${mempoolbins.bins[i][1]} sat/b`;
        }

        let truncate = 120; // 120*15 = 1800s, half an hour.

        let utcdate = new Date(mempoolbins.time*1000);
        if (COLUMNS) {
            COLUMNS[0].push(utcdate);
        } else {
            COLUMNS = [ ["x", utcdate] ];
        }

        let excess_entries = (COLUMNS[0].length - truncate) - 1;
        if (excess_entries > 0) {
            COLUMNS[0] = COLUMNS[0].slice(excess_entries);
            COLUMNS[0][0] = "x";
        }

        let i = 0;
        for (let n of mempoolbins.bins.map(x => x[6])) {
            if ((COLUMNS.length - 2) < i) {
                let label = getLabel(mempoolbins.bins[i][1]);
                COLUMNS.push([label]);
            }

            COLUMNS[i+1].push(n);

            if (excess_entries > 0) {
                COLUMNS[i+1] = COLUMNS[i+1].slice(excess_entries);
                let label = getLabel(mempoolbins.bins[i][1]);
                COLUMNS[i+1][0] = label;
            };

            i++;
        };

        if (redraw) {
            if (!CHART) {
                CHART = c3.generate({
                    bindto: "#mempoolchart",
                    data: {
                        x: "x",
                        columns: COLUMNS,
                    },
                    axis: {
                        x: {
                            type: "timeseries",
                            padding: { left: 0, right: 0 },
                            tick: {
                                count: 7,
                                format: function (v) { return moment(v).format('MMM DD HH:mm'); },
                            },
                        },
                        y: {
                            min: 0,
                            padding: { bottom: 0 },
                        },
                    },
                    legend: {
                        position: "right",
                    },
                    grid: {
                        x: { show: true },
                        y: { show: true },
                    },
                    color: {
                        pattern: ["#ff00f0", "#ff00c0", "#ff00a0", "#ff0000", "#ee0000", "#dd0000", "#cc0000", "#bb0000", "#aa0000", "#990000", "#880000", "#770000", "#660000", "#000000", "#444444", "#666666", "#888888", "#aaaaaa", "#cccccc"],
                    },
                });
            } else {
                CHART.load({
                    columns: COLUMNS,
                });
            }

            app.mempoolbins = mempoolbins;
        }
    }

    let dealWithMempoolBinsRange = function(response) {
        for (let i = 0; i < response.list.length; i++) {
            let mempoolbins = response.list[i];
            if (i !== response.list.length-1) {
                dealWithMempoolBins(mempoolbins, redraw=false);
            } else {
                dealWithMempoolBins(mempoolbins);
            }
        }
    }

    let dealWithBlock = function(block) {
        Vue.set(app.blocks, block.hash, block);
        if (Object.keys(app.blocks).length < 3) {
            app.getBlockIfRequired(block.previousblockhash);
        }
    }

    let dealWithPing = function(pong) {
        if (!app.connected) {
            onConnect();
        }
        app.lastpong = app.now;
    }

    let processAsyncResponse = function(request, response) {
        if (request.startsWith("ping")) {
            dealWithPing(response);
        } if (request.startsWith("chaininfo")) {
            dealWithChaininfo(response);
        } else if (request.startsWith("block/notxdetails")) {
            dealWithBlock(response);
        } else if (request.startsWith("mempool/bins/range")) {
            dealWithMempoolBinsRange(response);
        } else if (request.startsWith("mempool/bins")) {
            dealWithMempoolBins(response);
        }
    }

    let onConnect = function() {
        app.connected = true;
        asyncRequest(`chaininfo`, processAsyncResponse);
        setBinInterval(INITIAL_RANGE); // implicit fetch of mempool/bins/range
    }

    let onDisconnect = function() {
        app.connected = false;
    }

    asyncRequest(`ping`, processAsyncResponse);
}
