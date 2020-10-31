const puppeteer = require('puppeteer');
const UserAgent = require('user-agents');
const fs = require("fs");

const config = require("./config");

const express = require("express");
const app = express();

let callback = () => {
};


let run = true;
let toLoad = "https://www.spigotmc.org/resources";
let toLoadTime = 0;

let initWasSuccess = false;
let lastToLoad = "";
let lastToLoadTime = 0;

const saveDebugImages = config.saveDebugImages;

(async () => {
    await start();
})();

function newUserAgent() {
    let userAgents = JSON.parse(fs.readFileSync("./crawler-user-agents.json"));
    let a = Math.floor(Math.random() * userAgents.length);
    let agent = userAgents[a];
    console.log(agent);
    let b = Math.floor(Math.random() * agent.instances.length);
    let instance = agent.instances[b];
    console.log(instance);
    return instance;
    // return new UserAgent().toString()
}

async function start() {
    // console.log("Checking toLoad...");
    let exists = fs.existsSync("toload.txt");
    if (!exists) {
        fs.writeFileSync("page.html", "" + "\n" + 0 + "\n", "utf8");
        setTimeout(() => start(), 30000);
        callback("", 0, "");
        return;
    }
    run = true;

    console.log("Starting...");

    const browser = await puppeteer.launch();
    try {
        const page = await browser.newPage();
        let cookiesArr = JSON.parse(fs.readFileSync("./cookies.json").toString("utf8"));
        for (let c of cookiesArr) {
            await page.setCookie(c);
        }
        let ua = fs.readFileSync("./useragent.txt").toString("utf8");
        if (!ua || ua.length < 2) {
            ua = newUserAgent();
        }
        console.log("Using User-Agent: " + ua);
        await page.setUserAgent(ua)

        let init = await tryGet(page, ua, "https://www.spigotmc.org/", true);
        initWasSuccess = init;
        if (!init) {
            try {
                await page.close();
            } catch (e) {
            }
            await browser.close();
            setTimeout(() => start(), 10000);
        } else {
            let t = 0;
            while (run) {
                await sleep(500);
                if (toLoad) {
                    lastToLoad = toLoad;
                    lastToLoadTime = toLoadTime;
                    let curr;
                    try {
                        curr = await tryGet(page, ua, toLoad);
                    } catch (e) {
                        console.warn(e);
                        curr = false;
                    }
                    if (curr) {
                        t = 0;
                        toLoad = null;
                    } else {
                        if (t++ > 5) {
                            console.log("Skipping page");
                            fs.writeFileSync("page.html", toLoad + "\n" + 0 + "\n", "utf8");
                            callback(toLoad, 0, "");
                            toLoad = null;
                            t = 0;
                        }
                        await sleep(1000);
                    }
                    await sleep(1000);
                }
                let exists = fs.existsSync("toload.txt");
                if (exists) {
                    let newToLoad = fs.readFileSync("toload.txt").toString("utf8");
                    let newFileTime = fs.statSync("toload.txt").mtimeMs;
                    if (newToLoad !== lastToLoad || Math.abs(newFileTime - lastToLoadTime) > 100) {
                        toLoad = newToLoad;
                        toLoadTime = newFileTime;
                        console.log("New toLoad: " + toLoad);
                    }
                } else {
                    console.log("toload.txt doesn't exist, pausing");
                    run = false;
                    toLoad = "";
                    lastToLoad = "";
                    lastToLoadTime = 0;
                    setTimeout(() => start(), 30000);
                }
            }
            await browser.close();
            console.log("browser closed");
        }
    } catch (e) {
        console.error(e);
        await browser.close();
        console.log("browser closed");
    }
}

async function tryGet(page, ua, url, doNotWrite) {
    console.log("Loading page...");
    console.log("tryGet " + url);
    let resp = await page.goto(url);
    if (saveDebugImages) await page.screenshot({path: 'first.png'});
    let cookies = await page.cookies();
    console.log("Code: " + resp.status());
    let status = 0;
    let c = 0;
    while ((status = resp.status()) > 420 && (c++ < 20)) {
        await sleep(1000);
        console.log("Waiting for navigation...")
        resp = await page.waitForNavigation({timeout: 60000, waitUntil: "networkidle0"});
        if (saveDebugImages) await page.screenshot({path: 'second' + (c++) + '.png'});
        console.log("Code: " + (status = resp.status()));
        cookies = await page.cookies();
        saveCookies(cookies);
        await sleep(1000);
    }
    console.log("Last Status: " + status);
    if (status < 400 || (initWasSuccess && status < 500)) { // allow 403s if the first request was a success since it's probably an access thing for premium resources
        console.log("Waiting for xenforo selector...")
        // await page.waitForNavigation();
        try {
            await page.waitForSelector("div#navigation", {timeout: 60000})
            if (saveDebugImages) await page.screenshot({path: 'third.png'});
            console.log("Got xenforo page!")

            let content = await page.content();
            if (!doNotWrite) {
                fs.writeFileSync("page.html", url + "\n" + status + "\n" + content, "utf8");
                callback(url, status, content, cookies);
            }

            cookies = await page.cookies();
            saveCookies(cookies);
            saveUserAgent(ua)
            return true;
        } catch (e) {
            console.warn(e);
            if (initWasSuccess && status < 500) {
                console.log("Resetting cookies");
                saveCookies([]);
                saveUserAgent("")
            }
            await page.screenshot({path: 'selector_error.png'});
            if (status > 400) {
                console.log("Skipping page");
                fs.writeFileSync("page.html", url + "\n" + status + "\n", "utf8");
                toLoad = null;
                callback(url, status, "");
            }
            return false;
        }
    } else {
        console.log("Resetting cookies");
        saveCookies([]);
        saveUserAgent("")

        await page.screenshot({path: 'status_error.png'});

        return false;
    }
}

app.get("/*", (req, res) => {
    let url = decodeURIComponent(req.path.substr(1));
    let allow = url.startsWith("https://spigotmc.org") || url.startsWith("https://www.spigotmc.org");
    console.log((allow ? "ALLOW" : "DENY") + " " + url);
    if (!allow) {
        res.status(403);
        res.end();
        return;
    }
    let sent = false;
    callback = (url1, status, content) => {
        if (sent) return;
        if (url1 === url) {
            res.json({
                url: url1,
                status: status,
                content: Buffer.from(content).toString('base64')
            });
            sent = true;
        }
    };
    fs.writeFileSync("toload.txt", url, "utf8");
});
app.listen(config.port, () => {
    console.log("Listening on port " + config.port);
});


function sleep(t) {
    return new Promise(resolve => {
        setTimeout(resolve, t);
    })
}

function saveCookies(cookies) {
    fs.writeFileSync("./cookies.json", JSON.stringify(cookies))
    let simpleCookies = {};
    for (let c of cookies) {
        simpleCookies[c.name] = c.value;
    }
    fs.writeFileSync("./cookies_simple.json", JSON.stringify(simpleCookies));
}

function saveUserAgent(ua) {
    fs.writeFileSync("./useragent.txt", ua);
}
