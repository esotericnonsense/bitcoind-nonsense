#!flask/bin/python
from flask import Flask, jsonify
import requests
import math

import sqlite3
import ujson as json
import datetime

BACKEND_URI = "http://localhost:8332/rest"
DEBUG = True

app = Flask(__name__)

def error_response(string):
    o = { 
        "error": string,
    }

    return jsonify(o)

@app.route("/api/chaininfo")
def chaininfo():
    l = []

    try:
        r = requests.get("{}/chaininfo.json".format(BACKEND_URI))
        j = r.json()
    except:
        return error_response("backend unavailable")

    j.pop("softforks", None) # reduce output size
    j.pop("bip9_softforks", None) # reduce output size

    return jsonify(j)

def sanity_check_blockhash(h):
    if len(h) != 64:
        return False

    if h[:4] != "0000": # difficulty requires this
        return False

    try:
        int(h, 16)
    except ValueError:
        return False

    return True

@app.route("/api/block/notxdetails/<string:h>")
def block_notxdetails(h):
    if not sanity_check_blockhash(h):
        return error_response("invalid hash value")

    try:
        r = requests.get("{}/block/notxdetails/{}.json".format(BACKEND_URI, h))
        if r.status_code != 200:
            return error_response("backend: http error {}".format(r.status_code))
    except:
        if DEBUG:
            print(r.text)
            import traceback
            traceback.print_exc()
        return error_response("backend unavailable")

    try:
        j = r.json()
    except requests.json.decoder.JSONDecodeError:
        return error_response("backend sent non-json")

    j.pop("tx", None) # reduce output size

    return jsonify(j)

MAX_BITCOINS = 21*(10**14)
def bin_it(n):
    x = n + 0.00001 # ceil integers to next bin

    if (x < 5):
        return math.ceil(x)
    if (x < 30):
        return math.ceil(x / 5) * 5
    if (x < 60):
        return math.ceil(x / 30) * 30
    if (x < 300):
        return math.ceil(x / 50) * 50
    if (x < 500):
        return math.ceil(x / 100) * 100
    if (x < 1000):
        return math.ceil(x / 500) * 500

    return MAX_BITCOINS

BINS = sorted(list(set(bin_it(n) for n in range(1, 1001))))

epoch = datetime.datetime.utcfromtimestamp(0)
def unix_time_seconds(dt):
    return (dt - epoch).total_seconds()

from collections import OrderedDict
def bin_mempool_contents(mempoolcontents):
    utcnow = datetime.datetime.utcnow() # a hack for now
    bins = OrderedDict(
        (b, [])
        for b in BINS
    )

    size_segwit = 0
    for txid, tx in mempoolcontents.items():
        if "wtxid" not in tx:
            size_segwit = "?"
        if "wtxid" in tx and tx["wtxid"] != txid:
            size_segwit += 1

        sat_b = round(tx["fee"]*(10**8)/tx["size"])

        bins[bin_it(sat_b)].append([tx["size"], tx["fee"]*(10**8)])

    binned = []
    prevbin = 1

    cum_size = 0
    cum_bytes = 0
    cum_fees = 0
    for b, transactions in bins.items():
        total_size = len(transactions)
        cum_size += total_size

        total_bytes = sum(tx[0] for tx in transactions)
        cum_bytes += total_bytes

        total_fees = sum(tx[1] for tx in transactions)
        cum_fees += total_fees

        binned.append([prevbin, b, total_size, total_bytes, total_fees, cum_size, cum_bytes, cum_fees])
        prevbin = b

    return {
        "time": unix_time_seconds(utcnow),
        "size": cum_size,
        "size_segwit": size_segwit,
        "bytes": cum_bytes,
        "fees": cum_fees,
        "bins": list(reversed(binned)),
    }

@app.route("/api/mempool/bins")
def mempool_bins():
    try:
        r = requests.get("{}/mempool/contents.json".format(BACKEND_URI))
        if r.status_code != 200:
            return error_response("backend: http error {}".format(r.status_code))
    except:
        if DEBUG:
            print(r.text)
            import traceback
            traceback.print_exc()
        return error_response("backend unavailable")

    try:
        j = r.json()
    except requests.json.decoder.JSONDecodeError:
        return error_response("backend sent non-json")

    try:
        response = bin_mempool_contents(j)
    except:
        import traceback
        traceback.print_exc()
        return error_response("backend sent unknown format")

    return jsonify(response)

ALLOWABLE_RANGES = [30, 120, 240, 480, 1440, 2880, 5760, 10080]
@app.route("/api/mempool/bins/range/<int:minutes>")
def mempool_bins_range(minutes):
    if not (minutes in ALLOWABLE_RANGES):
        return error_response("invalid range")

    with sqlite3.connect("database/mempoolbins.db") as conn:
        c = conn.cursor()

        # Get the last two hours.
        utc_range_ms = int(unix_time_seconds(
            datetime.datetime.utcnow() - datetime.timedelta(minutes=minutes)
        ) * 1000)

        c.execute('''SELECT * FROM (SELECT * FROM mempoolbins WHERE utc_ms > ? ORDER BY random() LIMIT 120) ORDER BY utc_ms''', (utc_range_ms, ))
        l = [
            json.loads(r[1])
            for r in c
        ]

    return jsonify({"list": l})

def form_rpc_request(req, params=[], ident="0"):
    return {
        "jsonrpc": "2.0",
        "id": ident,
        "method": req,
        "params": params,
    }

"""
def form_batch_rpc_request(reqs): # list of tuples [(req, params)]
    l = []
    i = 0
    print(reqs)
    for req, params in reqs:
        l.append(form_rpc_request(req, str(i), params))
        i += 1

    print(l)
    return json.dumps(l)
"""

import base64
def parse_rpc_config(path):
    with open(path, "r") as f:
        cfg = {}
        for line in f:
            key, param = line.replace("\n", "").split("=", 1)
            cfg[key] = param

    rpcdetails = ":".join([cfg["rpcuser"], cfg["rpcpassword"]])
    rpcauth = base64.encodestring(bytes(rpcdetails, "utf-8"))[:-1].decode("utf-8")

    rpc_headers = {
        "Authorization": "Basic {}".format(rpcauth),
        "Content-Type": "text/plain",
    }

    rpc_url = cfg["rpcurl"]

    return rpc_url, rpc_headers

RPC_URL, RPC_HEADERS = parse_rpc_config("rpc.conf")

def call_rpc(req):
    r = requests.post(
        RPC_URL,
        headers=RPC_HEADERS,
        data=json.dumps(form_rpc_request(req))
    )

    return r.json()

@app.route("/api/peerinfo")
def peerinfo():
    d = call_rpc("getpeerinfo")
    if d["error"]:
        return error_response("error from backend")

    relevant_keys = [
        "addr",
        "bytesrecv",
        "bytessent",
        "conntime",
        "inbound",
        "synced_blocks",
        "subver",
    ]

    resp = [
        {
            key: peer[key]
            for key in relevant_keys
            if key in peer
        }
        for peer in d["result"]
    ]

    return jsonify(resp)

@app.route("/api/ping")
def ping():
    return jsonify({"pong": True})

@app.route("/")
@app.route("/<path:path>")
def catch_all(path=None):
    return error_response("invalid endpoint")

if __name__ == "__main__":
    app.run(debug=DEBUG)
