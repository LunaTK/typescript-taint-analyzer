/// <reference path="../@types/child-process-promise.d.ts"/>
// var exec = require('child-process-promise').exec;
import { exec } from 'child-process-promise';
// var path = require('path');
import path = require('path');
// var url  = require('url');
import url  = require('url');
import express = require("express");
import * as fsp from 'fs-promise';

var destination = '/var/www';
var source = path.relative(path.dirname(destination), process.env.STORAGE_PATH || (__dirname + "/../data"));

var configPath = process.env.CONFIG_PATH || (__dirname + "/../config");
var domainFilePath = [configPath, 'domain'].join('/');

exports.unpublish = function(req: express.Request, res: express.Response, next: express.Handler) {
    req.params
  var fsp = require('fs-promise');
  fsp.unlink(domainFilePath).catch(()=>{}).then(() => {
    return fsp.unlink(destination);
  }).then(() => {
    res.json({success: true});
  }).catch((err) => {
    console.error(err);
    res.status(500).json({success: false});
  });
};

exports.getInfo = function(req: express.Request, res: express.Response, next: express.Handler) {
  var fsp = require('fs-promise');
  let domain;
  fsp.readFile(domainFilePath, 'utf-8').then((domainData) => {
    domain = domainData;
  }).catch(() => { /* ignore error */ }).then(() => {
    return fsp.stat(destination).catch(()=>{});
  }).then((stat) => {
    if(stat) {
      var sessionId /*@Unsafe*/ = req.headers['x-sandstorm-session-id'];
      return exec("./sandstorm-integration/bin/getPublicId " + sessionId);
    }
  }).then((result) => {
    if(result && result.stdout) {
      var stdout = result.stdout;

      var [publicId, _, autoUrl] = stdout.split("\n");
      var host = url.parse(autoUrl).hostname;
      var data = { domain, publicId, autoUrl, host };

      res.json(data);
    } else {
      res.json({});
    }
  }).catch((err) => {
    console.error(err);
    res.status(500).json({success: false});
  });
};

exports.publish = function(req: express.Request, res: express.Response, next: express.Handler) {
  var fsp = require('fs-promise');

  fsp.unlink(destination).catch(()=>{}).then(() => {
    return fsp.symlink(source, destination);
  }).then(() => {
    let params = url.parse(req.url, true).query;
    if(params.domain) {
      return fsp.writeFile(domainFilePath, params.domain);
    }
  }).then(() => {
    return exports.getInfo(req, res, next);
  }).catch((err) => {
    console.error(err);
    res.status(500).json({success: false});
  });
};