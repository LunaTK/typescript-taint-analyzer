var unsafeVar /*@Unsafe*/ = "unsafe";
var safeVar /*@Safe*/ = "safe";



import * as mysql from "mysql2";
import * as _ from 'lodash';
import express from 'express';

declare function asdf(): string;

function get/*@Unsafe*/(id) {
    return "";
}

const uploadedFilesPath = process.env.UPLOADED_FILES_DIR;
const some = get(uploadedFilesPath);
mysql.createConnection(some);

function test(req: express.Request, res: express.Response) {
    const unsafeString /*@Unsafe*/ = "hello";
    req.params.asf
    res.send(unsafeString);
}

// const test = {
//     getEnv: function test() {
//         return process.env;
//     },
//     unsafeString: process.env.UPLOADED_FILES_DIR
// }



