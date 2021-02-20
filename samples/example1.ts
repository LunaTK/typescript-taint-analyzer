/// <reference path="custom-typings.d.ts"/>
import * as mysql from "mysql2";

let unsafeString /*@Unsafe*/ = "12345";

function test() {
    return "" /*@Unsafe*/;
}

const uploadedFilesPath = process.env.UPLOADED_FILES_DIR;
mysql.createConnection(uploadedFilesPath);

let ttt = {
    unsafeField: "hi"
} /*@Unsafe*/

const obj = {
    inner: {
        unsafeProperty /*@Unsafe*/: "12345"
    }
}

interface SomeIn {
    [key: string]: string | number;
    val?: string;
}

const some = {
    hi: "123" /*@Unsafe*/,
    bye: 123
}

const tt = some.hi;
