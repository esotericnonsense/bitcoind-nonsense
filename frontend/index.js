// TODO: base API_URL on actual URI in browser
const API_URL = "https://esotericnonsense.com/api"
const ALL_BITCOINS = 21*(10**14);
const INITIAL_RANGE = 30;

var CHARTIST_DATA = {
    labels: [],
    series: [],
};
var CHART = null;
var CHARTIST_OPTIONS = {
    chartPadding: {
        top: 0,
        right: 0,
        bottom: 20,
        left: 30,
    },
    axisX: {
        type: Chartist.FixedScaleAxis,
        divisor: 5,
        labelInterpolationFnc: function(value, index) {
            return moment(value).format('MMM DD HH:mm');
        }
    },
    axisY: {
        low: 0,
    },
    plugins: [
        Chartist.plugins.ctAxisTitle({
            axisX: {
                axisTitle: 'fee / sat/b',
                axisClass: 'ct-axis-title',
                offset: {
                    x: 0,
                    y: 35
                },
                textAnchor: 'middle'
            },
            axisY: {
                axisTitle: 'cumulative size / b',
                axisClass: 'ct-axis-title',
                offset: {
                    x: 0,
                    y: -10
                },
                flipTitle: false
            },
        }),
    ],
}

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
            dots: "",
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

                CHARTIST_DATA = {
                    labels: [],
                    series: [],
                };

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

        app.dots += "•";
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

        asyncRequest(`mempool/bins/range/${range}`, processAsyncResponse);
        app.range = range;
    }

    let dealWithChaininfo = function(chaininfo) {
        app.chaininfo = chaininfo;
        app.getBlockIfRequired(chaininfo.bestblockhash);
    };

    let dealWithMempoolBins = function(mempoolbins, redraw=true) {
        app.dots = "";

        let truncate = 120; // 120*15 = 1800s, half an hour.

        let utcdate = new Date(mempoolbins.time*1000);

        app.mempoolbins = mempoolbins;
        let i = 0;
        for (let n of mempoolbins.bins.map(x => x[6])) {
            if (CHARTIST_DATA.series.length <= i) {
                CHARTIST_DATA.series.push({
                    name: `${mempoolbins.bins[i][0]}+ sat/b`,
                    data: [],
                });
            }

            CHARTIST_DATA.series[i].data.push({
                x: utcdate,
                y: n,
            });

            let l = CHARTIST_DATA.series[i].data.length - truncate;
            if (l > 0) {
                CHARTIST_DATA.series[i].data = CHARTIST_DATA.series[i].data.slice(l);
            };

            i++;
        };
        if (redraw) {
            if (!CHART) {
                CHART = new Chartist.Line('.ct-chart', CHARTIST_DATA, CHARTIST_OPTIONS);
            } else {
                CHART.update(CHARTIST_DATA);
            }
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
        app.lastpong = getCurrentTime();
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
