import requests
import sqlite3
import json
import datetime
from time import sleep

BACKEND_URI = "https://esotericnonsense.com/api"
def perform_mempoolbins_cycle(c, conn):
    try:
        r = requests.get("{}/mempool/bins".format(BACKEND_URI))
    except:
        print("mempoolbins: backend unavailable")
        return

    try:
        j = r.json()
    except:
        print("mempoolbins: json decoding error")
        return

    if not ("bins" in j):
        print("mempoolbins: incompatible response")
        return

    utc_ms = int(j["time"] * 1000) # we don't care about rounding off ms
    s = json.dumps(j)

    c.execute('''INSERT INTO mempoolbins VALUES (?, ?)''', (utc_ms, s))
    conn.commit()
    print("mempoolbins: {}\t logged".format(datetime.datetime.utcfromtimestamp(utc_ms/1000)))

def perform_nettotals_cycle(c, conn):
    try:
        r = requests.get("{}/nettotals".format(BACKEND_URI))
    except:
        print("nettotals: backend unavailable")
        return

    try:
        j = r.json()
    except:
        print("nettotals: json decoding error")
        return

    if not ("totalbytesrecv" in j):
        print("nettotals: incompatible response")
        return

    utc_ms = int(j["time"] * 1000) # we don't care about rounding off ms
    s = json.dumps(j)

    c.execute('''INSERT INTO nettotals VALUES (?, ?)''', (utc_ms, s))
    conn.commit()
    print("nettotals: {}\t logged".format(datetime.datetime.utcfromtimestamp(utc_ms/1000)))

if __name__ == "__main__":
    with sqlite3.connect("mempoolbins.db") as conn:
        c = conn.cursor()

        try:
            c.execute('''CREATE TABLE mempoolbins
                        (utc_ms integer, json text)''')
            conn.commit()
        except sqlite3.OperationalError:
            pass # Already created

        try:
            c.execute('''CREATE TABLE nettotals
                        (utc_ms integer, json text)''')
            conn.commit()
        except sqlite3.OperationalError:
            pass # Already created

    try:
        while True:
            perform_mempoolbins_cycle(c, conn)
            perform_nettotals_cycle(c, conn)
            sleep(15)
    finally:
        conn.commit()
