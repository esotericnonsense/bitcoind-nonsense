const socket = io("http://localhost:3000");

const ALL_BITCOINS = 21*(10**14);

var CHARTIST_DATA = {
    labels: [],
    series: [],
};
var CHART = null;
var CHARTIST_OPTIONS = {
    /* showArea: true, */
    chartPadding: {
        top: 0,
        right: 0,
        bottom: 20,
        left: 20,
    },
    axisX: {
        type: Chartist.FixedScaleAxis,
        divisor: 5,
        labelInterpolationFnc: function(value, index) {
            return moment(value).format('hh:mm:ss');
        }
    },
    axisY: {
        low: 0,
    },
    plugins: [
        Chartist.plugins.tooltip({
            anchorToPoint: true,
        }),
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

var getCurrentTime = function() {
    return ((new Date()).getTime() / 1000);
};
var getCurrentTimeUTC = function() {
    let now = new Date();
    return Math.floor((now.getTime() + now.getTimezoneOffset() * 60000)/1000);
};

onload = function() {
    el_out = document.getElementById("output");

    var app = new Vue({
        el: '#app',
        data: {
            connected: false,
            now: getCurrentTime(),
            dots: "",
            chaininfo: null,
            mempoolbins: null,
            blocks: {},
            messages: [],
            request_count: 0
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
                socket.emit("request", app.request_count, "block/notxdetails", hash);
                app.request_count++;
            },
        },
    })

    setInterval(function() {
        app.now = getCurrentTime();
        if (!app.connected) {
            return;
        }
        socket.emit("request", app.request_count, "chaininfo");
        app.request_count++;
        app.dots += "•"
    }, 1000);

    setInterval(function() {
        if (!app.connected) {
            return;
        }
        socket.emit("request", app.request_count, "mempool/bins");
        app.request_count++;
    }, 15000);

    socket.on("chaininfo", function(chaininfo) {
        app.chaininfo = chaininfo;
        app.getBlockIfRequired(chaininfo.bestblockhash);
    });

    socket.on("mempool/bins", function(mempoolbins) {
        app.dots = "";

        let truncate = 120; // 120*15 = 1800s, half an hour.

        let now = new Date();

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
                x: now,
                y: n,
            });

            let l = CHARTIST_DATA.series[i].data.length - truncate;
            if (l > 0) {
                CHARTIST_DATA.series[i].data = CHARTIST_DATA.series[i].data.slice(l);
            };

            i++;
        };
        if (!CHART) {
            CHART = new Chartist.Line('.ct-chart', CHARTIST_DATA, CHARTIST_OPTIONS);
        } else {
            CHART.update(CHARTIST_DATA);
        }
    });

    socket.on("block/notxdetails", function(block) {
        // console.log(`got block ${block.hash}`);
        Vue.set(app.blocks, block.hash, block);
        if (Object.keys(app.blocks).length < 3) {
            app.getBlockIfRequired(block.previousblockhash);
        }
    });

    socket.on("hello", function () {
        app.connected = true;
        socket.emit("request", app.request_count, "chaininfo");
        app.request_count++;
        socket.emit("request", app.request_count, "mempool/bins");
        app.request_count++;
    });

    socket.on("disconnect", function () {
        app.connected = false;
        app.dots = "";
        app.messages = [];
    });
}
