// TODO: base API_URL on actual URI in browser
const API_URL = `${window.location.protocol}//${window.location.host}/api`
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
            nettotals: null,
            blocktemplate: null,
            bt_logscale: true,
            peers: null,
            data: 6,
            range: 0,
            tab: "block-template",
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
                    return `${h}h ${m}m`;
                } else if (m) {
                    return `${m}m ${s}s`;
                } else {
                    return `${s}s`;
                }
            },
            blockIntervalBar: function(seconds) {
                let minutes = Math.floor(seconds / 60);
                return "*".repeat(minutes);
            },
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

                asyncRequest(`blockinfo/${hash}`, processAsyncResponse);
            },
            setRange: function(range) {
                if (range === app.range) {
                    return;
                }

                COLUMNS = null;

                // when the response comes in the graph will reset.
                clearBinInterval();
                setBinInterval(range);
            },
            setData: function(data) {
                if (data === app.data) {
                    return;
                }

                app.data = data;

                // TODO: this is pretty hacky.
                COLUMNS = null;

                // when the response comes in the graph will reset.
                clearBinInterval();
                setBinInterval(app.range);
            },
            setTab: function(tab) {
                app.tab = tab;
            },
            rdBT: function() {
                if (app.blocktemplate === undefined) { return; }
                redrawBlockTemplate(app.blocktemplate);
            },
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
        asyncRequest(`peerinfo`, processAsyncResponse);
        asyncRequest(`blocktemplate`, processAsyncResponse);
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
            asyncRequest(`nettotals`, processAsyncResponse);
        }, range*60000/120);

        app.range = range;
        app.last_updated = app.now; // makes next update appear cleanly

        asyncRequest(`mempool/bins/range/${range}`, processAsyncResponse);
        asyncRequest(`nettotals/range/${range}`, processAsyncResponse);
    }

    let dealWithChaininfo = function(chaininfo) {
        app.chaininfo = chaininfo;
        app.getBlockIfRequired(chaininfo.bestblockhash);
    };

    let dealWithPeerinfo = function(peerinfo) {
        app.peers = peerinfo.peerinfo;
    }

    var BTCHART = null;

    let dealWithBlockTemplate = function(blocktemplate) {
        app.last_updated = app.now;
        app.blocktemplate = blocktemplate;

        redrawBlockTemplate(blocktemplate);
    }

    let redrawBlockTemplate = function(blocktemplate) {
        let cum_vsize = 0;
        let feerates = ["feerate"];
        let cum_vsizes = ["cum_vsize"];
        for (let tx of blocktemplate.tx) {
            let feerate = tx[0];
            let vsize = tx[1];

            // let depends = tx[2];
            if (app.bt_logscale) {
                feerates.push(Math.log(feerate)/Math.log(2));
            } else {
                feerates.push(feerate);
            }
            cum_vsizes.push(cum_vsize);
            cum_vsize += vsize;
        }

        let btcolumns = [
            cum_vsizes,
            feerates
        ];

        if (!BTCHART) {
            BTCHART = c3.generate({
                bindto: "#blocktemplatechart",
                data: {
                    x: "cum_vsize",
                    columns: btcolumns,
                    type: "area",
                },
                point: {
                    show: false,
                },
                axis: {
                    x: {
                        tick: {
                            values: [0, 200000, 400000, 600000, 800000, 1000000],
                        }
                    },
                    y: {
                        tick: {
                            format: function (y) {
                                if (app.bt_logscale) {
                                    return Math.pow(2, y).toFixed(2);
                                }
                                return y.toFixed(2);
                            },
                        },
                    },
                },
                tooltip: {
                    format: {
                        value: function(y, ratio, id) {
                            if (app.bt_logscale) {
                                return `${Math.pow(2, y).toFixed(2)} sat/b`;
                            }
                            return `${y.toFixed(2)} sat/b`;
                        }
                    }
                }
            });
        } else {
            BTCHART.load({
                columns: btcolumns,
            });
        }
    }

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
        let divisor = 0;
        if (app.data === 7) {
            divisor = 100000;
        } else if (app.data === 6) {
            divisor = 1048576;
        }
        for (let n of mempoolbins.bins.map(x => x[app.data])) {
            if ((COLUMNS.length - 2) < i) {
                let label = getLabel(mempoolbins.bins[i][1]);
                COLUMNS.push([label]);
            }

            if (divisor) {
                COLUMNS[i+1].push(n/divisor);
            } else {
                COLUMNS[i+1].push(n);
            }

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
                    tooltip: {
                        format: {
                            value: function (value, ratio, id) {
                                if (app.data === 5) {
                                    return `${value} tx`;
                                } else if (app.data === 6) {
                                    return `${value.toFixed(3)} MiB`;
                                } else if (app.data === 7) {
                                    return `${value.toFixed(2)} mBTC`;
                                }
                            },
                        },
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
        if (Object.keys(app.blocks).length < 12) {
            app.getBlockIfRequired(block.previousblockhash);
        }
    }

    let dealWithPing = function(pong) {
        if (!app.connected) {
            onConnect();
        }
        app.lastpong = app.now;
    }

    var NETCHART = null;
    var NETCOLUMNS = null;
    var NETLABELS = {
        "totalbytesrecv": "in / MiB",
        "totalbytessent": "out / MiB",
    }

    let dealWithNettotals = function(nettotals, redraw=true) {
        // app.last_updated = app.now;

        let truncate = 120; // 120*15 = 1800s, half an hour.

        let utcdate = new Date(nettotals.time*1000);
        if (NETCOLUMNS) {
            NETCOLUMNS[0].push(utcdate);
        } else {
            NETCOLUMNS = [ ["x", utcdate] ];
        }

        let excess_entries = (NETCOLUMNS[0].length - truncate) - 1;
        if (excess_entries > 0) {
            NETCOLUMNS[0] = NETCOLUMNS[0].slice(excess_entries);
            NETCOLUMNS[0][0] = "x";
        }

        let i = 0;
        for (let key of ["totalbytesrecv", "totalbytessent"]) {
            n = nettotals[key];

            if ((NETCOLUMNS.length - 2) < i) {
                NETCOLUMNS.push([NETLABELS[key]]);
            }

            NETCOLUMNS[i+1].push(n/1048576);

            if (excess_entries > 0) {
                NETCOLUMNS[i+1] = NETCOLUMNS[i+1].slice(excess_entries);
                NETCOLUMNS[i+1][0] = NETLABELS[key];
            };

            i++;
        };

        if (redraw) {
            if (!NETCHART) {
                NETCHART = c3.generate({
                    bindto: "#networkchart",
                    data: {
                        x: "x",
                        columns: NETCOLUMNS,
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
                        pattern: ["darkgreen", "crimson"],
                    },
                });
            } else {
                NETCHART.load({
                    columns: NETCOLUMNS,
                });
            }

            app.nettotals = nettotals;
        }
    }

    let dealWithNettotalsRange = function(response) {
        for (let i = 0; i < response.list.length; i++) {
            let nettotals = response.list[i];
            if (i !== response.list.length-1) {
                dealWithNettotals(nettotals, redraw=false);
            } else {
                dealWithNettotals(nettotals);
            }
        }
    }

    let processAsyncResponse = function(request, response) {
        if (request.startsWith("ping")) {
            dealWithPing(response);
        } else if (request.startsWith("chaininfo")) {
            dealWithChaininfo(response);
        } else if (request.startsWith("peerinfo")) {
            dealWithPeerinfo(response);
        } else if (request.startsWith("blockinfo")) {
            dealWithBlock(response);
        } else if (request.startsWith("blocktemplate")) {
            dealWithBlockTemplate(response);
        } else if (request.startsWith("mempool/bins/range")) {
            dealWithMempoolBinsRange(response);
        } else if (request.startsWith("mempool/bins")) {
            dealWithMempoolBins(response);
        } else if (request.startsWith("nettotals/range")) {
            dealWithNettotalsRange(response);
        } else if (request.startsWith("nettotals")) {
            dealWithNettotals(response);
        }
    }

    let onConnect = function() {
        app.connected = true;
        asyncRequest(`chaininfo`, processAsyncResponse);
        asyncRequest(`peerinfo`, processAsyncResponse);
        asyncRequest(`blocktemplate`, processAsyncResponse);
        setBinInterval(INITIAL_RANGE); // implicit fetch of mempool/bins/range, nettotals/range
    }

    let onDisconnect = function() {
        app.connected = false;
    }

    asyncRequest(`ping`, processAsyncResponse);
}
