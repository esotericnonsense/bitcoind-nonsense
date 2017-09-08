#!flask/bin/python
from flask import Flask, jsonify
import requests
import math

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

BINS = sorted(list(set(bin_it(n) for n in range(1001))))

def bin_mempool_contents(mempoolcontents):
    bins = {
        b: []
        for b in BINS
    }

    size_segwit = 0
    for txid, tx in mempoolcontents.items():
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

@app.route("/api/ping")
def ping():
    return jsonify("pong")

@app.route("/")
@app.route("/<path:path>")
def catch_all(path=None):
    return error_response("invalid endpoint")

if __name__ == "__main__":
    app.run(debug=DEBUG)
