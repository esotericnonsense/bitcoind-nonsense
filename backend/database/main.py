import requests
import sqlite3
import json
import datetime
from time import sleep

BACKEND_URI = "https://esotericnonsense.com/api"
def perform_one_cycle(c, conn):
    try:
        r = requests.get("{}/mempool/bins".format(BACKEND_URI))
    except:
        print("backend unavailable")
        return

    try:
        j = r.json()
    except:
        print("json decoding error")
        return

    if not ("bins" in j):
        print("incompatible response")
        return

    utc_ms = int(j["time"] * 1000) # we don't care about rounding off ms
    s = json.dumps(j)

    c.execute('''INSERT INTO mempoolbins VALUES (?, ?)''', (utc_ms, s))
    conn.commit()
    print("{}\t logged".format(datetime.datetime.utcfromtimestamp(utc_ms/1000)))

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
        while True:
            perform_one_cycle(c, conn)
            sleep(15)
    finally:
        conn.commit()
