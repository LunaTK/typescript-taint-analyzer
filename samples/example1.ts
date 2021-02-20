/// <reference path="custom-typings.d.ts"/>
import * as mysql from "mysql2";

let unsafeString /*@Unsafe*/ = "12345";

const uploadedFilesPath = process.env.UPLOADED_FILES_DIR;
mysql.createConnection(uploadedFilesPath);

let ttt /*@Safe*/ = {
    unsafeField /*@Unsafe*/: "hi"
} /*@Safe*/

const obj = {
    inner: {
        unsafeProperty /*@Unsafe*/: "12345"
    }
}

interface SomeIn {
    [key /*@Unsafe*/: string]: string | number;
    val?: string;
}

const some: SomeIn = {
    hi: "123",
    bye: 123
}

const tt = some.hi;

some.hi = 123;


