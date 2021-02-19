/// <reference path="custom-typings.d.ts"/>
import * as mysql from "mysql2";

let unsafeString /*@Unsafe*/ = "12345";

const obj = {
    inner: {
        unsafeProperty /*@Unsafe*/: "12345"
    }
}

interface SomeIn {
    [key /*@Unsafe*/: string]: string | number;
    val?: string;
}

let ttt /*@Safe*/ = {
    unsafeField /*@Unsafe*/: "hi"
}

const some: SomeIn = {
    hi: "123",
    bye: 123
}

const tt = some.hi;

some.hi = 123;

mysql.createConnection("");

