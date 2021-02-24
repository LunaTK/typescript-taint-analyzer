import express = require('express');
import * as path from 'path';
import * as jsonfile from 'jsonfile';

const some /*@Unsafe*/=1;

function readFile(file/*Unsafe*/: string): Promise<any> {
    return Promise.resolve('');
}

function ttt(req: express.Request) {
    const srcPath = path.join("homedir()", req.body.repoName, req.body.labName);
    jsonfile.readFile(path.join(srcPath, 'labels.json'));
}