'use strict';

const functions = require('firebase-functions');
const admin = require('firebase-admin');
admin.initializeApp();
const os = require('os');
const path = require('path');
const mkdirp = require('mkdirp-promise');
const spawn = require('child-process-promise').spawn;
const fs = require('fs');
const { promisify } = require('util');
const readFileAsync = promisify(fs.readFile);
const writeFileAsync = promisify(fs.writeFile);
const existsAsync = promisify(fs.exists)

const gm = require('gm').subClass({ imageMagick: true });
const d3 = require('d3');
const jsdom = require('jsdom');

class ExchangeRateChartGenerator {
    constructor(currencyCode) {
        this.margin = {
            top: 10, right: 12, bottom: 15, left: 30,
        };
        this.width = 425 - this.margin.left - this.margin.right;
        this.height = 200 - this.margin.top - this.margin.bottom;
        this.currencyCode = currencyCode;
    }

    loadRatesListJson(ratesJson) {
        const result = [];
        const parseTime = d3.timeParse('%Y-%m-%d %I:%M:%S');
        ratesJson.forEach((pricesInOneDate) => {
            pricesInOneDate.SpotListRate.forEach((countryRate) => {
                countryRate.UPDATETIME = parseTime(countryRate.UPDATETIME);
                const ccy = countryRate.CCY;
                if (d3.timeFormat('%H')(countryRate.UPDATETIME) < 17 && ccy === this.currencyCode) { // 只選取不是假日的價
                    result.push(countryRate);
                }
            });
        });
        this.ratesList = result;

    }

    generateSVGChart() {
        this.maxAskRate = d3.max(this.ratesList, (item) => item.ASKLISTRATE); //銀行最高買價
        this.minBidRate = d3.min(this.ratesList, (item) => item.BIDLISTRATE); //銀行最低賣價
        this.xScale = d3.scaleTime()
            .domain(d3.extent(this.ratesList, (item) => item.UPDATETIME))
            .range([0, this.width]);
        const niceRange = (this.maxAskRate - this.minBidRate) * 0.14;
        this.yScale = d3.scaleLinear()
            .domain([this.minBidRate - niceRange, this.maxAskRate + niceRange])
            .range([this.height, 0]);

        this.prepareSVGDOM();
        this.drawBlueBars();
        this.drawAxis();
        this.drawRatesLine();
        //fs.writeFileSync('output.svg', d3.select(this.dom.window.document).select('svg').node().outerHTML);
    }

    prepareSVGDOM() {
        this.dom = new jsdom.JSDOM('<!DOCTYPE html><html><body></body></html>');
        this.body = d3.select(this.dom.window.document).select('body');
        this.body.append('div')
            .attr('style', 'text-align: center')
            .append('h2')
            .attr('id', 'chartTitle')
            .text(`${this.ratesList[0].CCY} Exchange Rate`)
            .attr('style', 'text-align: center;padding:0px;margin:0px;');
        this.svg = this.body.select('div')
            .append('svg')
            .attr('id', 'chartRate')
            .attr('width', this.width + this.margin.left + this.margin.right)
            .attr('height', this.height + this.margin.top + this.margin.bottom)
            .append('g')
            .attr('transform', `translate(${this.margin.left}, ${this.margin.top})`);
    }

    drawBlueBars() {
        const gridHeight = 15;
        let color = 'rgba(68, 170, 213, 0.1)';
        const minHeight = this.yScale(this.maxAskRate);
        const maxHeight = this.yScale(this.minBidRate);
        for (let i = maxHeight; i > minHeight; i -= gridHeight) {
            this.svg.append('rect')
                .attr('x', 0).attr('y', i - gridHeight)
                .attr('width', this.width)
                .attr('height', gridHeight)
                .attr('fill', `${color}`);
            color = (color === 'rgba(68, 170, 213, 0.1)' ? 'rgba(0,0,0,0)' : 'rgba(68, 170, 213, 0.1)');
        }
    }

    drawAxis() {
        const [minDate, maxDate] = d3.extent(this.ratesList, (item) => item.UPDATETIME);
        const tickPeriod = (maxDate - minDate) / 6;
        let xTickPoints = [];
        for (let i = 1; i < 6; i++) {
            let date = parseInt(d3.timeFormat('%Q')(minDate)) + parseInt(i * tickPeriod);
            xTickPoints.push(d3.timeParse('%Q')(date))
        }

        let yTickPoints = [];
        const range = (this.maxAskRate - this.minBidRate) / 5;
        for (let i = 0; i < 6; i++) {
            let value = this.minBidRate + i * range;
            yTickPoints.push(value);
        }

        this.svg.append('g')
            .attr('class', 'x-axis')
            .attr('transform', `translate(0, ${this.height})`)
            .call(d3.axisBottom(this.xScale).tickSize(-this.height)
                .tickSizeOuter(0)
                .tickValues(xTickPoints)
                .tickFormat(d3.timeFormat('%b%d')))
            .select('.domain')
            .attr('stroke', '#D8D8D8');

        this.svg.selectAll('.x-axis')
            .attr('font-family', null)

        this.svg.selectAll('.tick')
            .selectAll('line')
            .attr('stroke', '#D8D8D8');

        this.svg.append('g')
            .attr('class', 'y-axis')
            .call(d3.axisLeft(this.yScale)
                .tickSize(0).tickValues(yTickPoints))
            .select('.domain')
            .remove();

        this.svg.selectAll('.tick')
            .selectAll('text')
            .attr('style', 'color:#707070;font-size:9px;text-transform:uppercase;fill:#707070;');
    }

    drawRatesLine() {
        const askListRateLine = d3.line()
            .x((d) => this.xScale(d.UPDATETIME)).curve(d3.curveBasis)
            .y((d) => this.yScale(d.ASKLISTRATE));

        const bidListRateLine = d3.line()
            .x((d) => this.xScale(d.UPDATETIME)).curve(d3.curveBasis)
            .y((d) => this.yScale(d.BIDLISTRATE));

        this.svg.append('path')
            .datum(this.ratesList)
            .attr('fill', 'none')
            .attr('stroke', '#7cb5ec')
            .attr('stroke-width', 2)
            .attr('d', askListRateLine);
        this.svg.append('path')
            .datum(this.ratesList)
            .attr('fill', 'none')
            .attr('stroke', '#f7a35c')
            .attr('stroke-width', 2)
            .attr('d', bidListRateLine);
    }

    drawBottomText() {
        const bottomIndicator = this.svg.append('g')
            .attr('transform', `translate(${(this.width - 119) / 2},${this.height + 13})`);

        bottomIndicator.append('path')
            .attr('fill', 'none')
            .attr('d', 'M 0 12 L 16 12')
            .attr('stroke', '#7cb5ec')
            .attr('stroke-width', 2);

        bottomIndicator.append('text')
            .attr('x', 21)
            .attr('y', 16)
            .attr('style', 'color:#333333;font-size:13px;font-weight:bold;cursor:pointer;fill:#333333;')
            .attr('text-anchor', 'start')
            .text('Sell');

        bottomIndicator.append('path')
            .attr('fill', 'none')
            .attr('d', 'M 70 12 L 86 12')
            .attr('stroke', '#f7a35c')
            .attr('stroke-width', 2);

        bottomIndicator.append('text')
            .attr('x', 91)
            .attr('y', 16)
            .attr('style', 'color:#333333;font-size:13px;font-weight:bold;cursor:pointer;fill:#333333;')
            .attr('text-anchor', 'start')
            .text('Buy');
    }

    async svgToPng() {
        const parseTime = d3.utcParse("%Y-%m-%dT%H:%M:%S.%LZ");
        const dateString = d3.timeFormat('%Y%m%d')(parseTime(new Date().toISOString()));
        const svgName = `${this.currencyCode}_HIGHLOW_${dateString}.svg`
        const imageName = `${this.currencyCode}_HIGHLOW_${dateString}.png`;
        const tempLocalDir = path.join(os.tmpdir(), 'output');
        const tempLocalSVGFile = path.join(tempLocalDir, svgName);
        const tempLocalImageFile = path.join(tempLocalDir, imageName);
        await mkdirp(tempLocalDir);
        await writeFileAsync(tempLocalSVGFile, d3.select(this.dom.window.document).select('svg').node().outerHTML);
        let options = [
            "-density", "72",
            "-quality", "40",
            "-define", "png:compression-level=9",
            "-define", "png:compression-filter=6",
            "-define", "png:compression-strategy=0",
            "-depth", "8",
            `svg:${tempLocalSVGFile}`, `png:${tempLocalImageFile}`];
        try {
            await spawn("convert", options);
        } catch (e) {
            console.error(e);
        } finally {
        }
        return tempLocalImageFile;
    }

    getSVG() {
        return d3.select(this.dom.window.document).select('svg').node().outerHTML;
    }
}

exports.generateSVG = functions.https.onRequest(async (req, res) => {
    const codes = ['USD', 'EUR', 'CNY', 'JPY', 'HKD'];
    const fxrate = JSON.stringify(req.body);
    let promises = [];
    for (const code of codes) {
        promises.push((async () => {
            let finalUrl;
            const generator = new ExchangeRateChartGenerator(code);
            generator.loadRatesListJson(JSON.parse(fxrate));
            generator.generateSVGChart();
            let fpath = await generator.svgToPng();
            if (await existsAsync(fpath)) {
                finalUrl = await (this.uploadPNGtoBucket(fpath));
            }
            return finalUrl;
        })())
    }
    let result = await Promise.all(promises);
    res.send(result);
})

exports.uploadPNGtoBucket = async (filePath) => {
    let today = new Date();
    let tomorrow = new Date();
    tomorrow.setDate(tomorrow.getDate()+1);
    let fileName = path.basename(filePath);
    let uploadPath = path.join(d3.timeFormat('%Y%m%d')(today), fileName);
    const bucket = admin.storage().bucket();
    const outputFile = bucket.file(uploadPath);
    await bucket.upload(filePath, { destination: uploadPath });
    console.log('generated rate image uploaded to storage at', filePath);
    //fs.unlinkSync(path.dirname(filePath));

    const config = {
        action: 'read',
        expires: d3.timeFormat('%m-%d-%Y')(tomorrow)
    };

    const result = await outputFile.getSignedUrl(config);
    return result[0];
}
