const {Telegraf} = require('telegraf');
const axios = require('axios');
const MD5 = require('crypto-js/md5');

const bot = new Telegraf(process.env.BOT_TOKEN);

const data = JSON.stringify({
    "bounds": {
        "bottomLeft": {
            "lat": 55.58416470985112,
            "lng": 48.569891667968704
        },
        "topRight": {
            "lat": 55.9495877464203,
            "lng": 49.630072332031176
        }
    },
    "filters": {
        "banks": [
            "tcs"
        ],
        "showUnavailable": true,
        "currencies": [
            "USD"
        ]
    },
    "zoom": 11
});

const config = {
    method: 'post',
    url: 'https://api.tinkoff.ru/geo/withdraw/clusters',
    headers: {
        'Content-Type': 'application/json'
    },
    data: data
};

const joinText = '\n-----------\n';
const defaultText = 'Пока нет нифига 😭';

async function isLastMessageImprintSame(message) {
    const md5Hash = MD5(message);
    const commands = await bot.telegram.getMyCommands();

    return commands[0] && (md5Hash.toString() === commands[0].description);
}

async function setLastMessageImprint(message) {
    const md5Hash = MD5(message);

    await bot.telegram.setMyCommands([{command: 'last_message_hash', description: md5Hash.toString()}]);
}

module.exports.handler = async function (event, context) {
    try {
        const {data} = await axios(config);
        const points = [];
        const pointTexts = [];
        const messages = [];

        if (data && data.payload && data.payload.clusters && data.payload.clusters.length) {
            data.payload.clusters.forEach(cluster => {
                cluster.points.forEach(point => {
                    const limit = point.limits.find(limit => limit.currency === 'USD');

                    if (limit && limit.amount >= 500) {
                        const day = new Date((new Date()).getTime() + (3 * 3600 * 1000)).getDay();
                        const workPeriod = point.workPeriods.find(workPeriod => workPeriod.openDay === day);

                        points.push({
                            amount: limit.amount,
                            location: point.location,
                            workPeriod: workPeriod,
                            address: point.address,
                        });
                    }
                })
            })
        }

        points.forEach(point => {
            const loc = point.location;
            const href = `https://www.google.com/maps/@${loc.lat},${loc.lng},17z`;
            const amount = point.amount === 5000 ? `более ${point.amount}` : point.amount;
            let workTime = '';

            if (point.workPeriod) {
                const {openTime, closeTime} = point.workPeriod;
                const open = `${openTime.substring(0, 2)}:${openTime.substring(2)}`;
                const close = `${closeTime.substring(0, 2)}:${closeTime.substring(2)}`;

                workTime = `🕐: ${open}-${close}`;
            }

            pointTexts.push(`<a href="${href}">${point.address}</a>\n💰: ${amount} USD\n${workTime}`);
        });

        let i = 0;
        let text = pointTexts.length ? '' : defaultText;
        pointTexts.forEach(pointText => {
            if (messages[i] === undefined) {
                messages[i] = '';
            }

            if ((messages[i].length + joinText.length + pointText.length) > 4096) {
                i++;
                messages[i] = '';
            }

            if (messages[i].length > 0) {
                messages[i] += joinText;
            }

            messages[i] += pointText;
            text += pointText;
        });

        if (!(await isLastMessageImprintSame(text))) {
            await setLastMessageImprint(text);

            if (messages.length) {
                messages.forEach(message => {
                    bot.telegram.sendMessage(process.env.CHANNEL_NAME, message, {
                        parse_mode: 'HTML',
                        disable_web_page_preview: true
                    });
                })
            } else {
                bot.telegram.sendMessage(process.env.CHANNEL_NAME, defaultText);
            }
        }

        return {
            statusCode: 200,
            body: '',
        };
    } catch (e) {
        return {
            statusCode: 500,
            body: e.toString(),
        };
    }
}
