import * as mysql from "mysql2";
import * as express from 'express';
import * as core from 'express-serve-static-core';
import * as cpp from 'child-process-promise';
import {
    ExecOptions
} from 'child_process';

declare module 'child-process-promise' {
    function exec(
        command /*@Safe*/: Readonly<string>,
        options: Readonly<Options & { encoding: "buffer" | null } & ExecOptions>
    ): ChildProcessPromise<PromiseResult<Buffer>>;
}

declare module "mysql2" {
    function createConnection(connectionUri /*@Safe*/: string): mysql.Connection;
}

declare module "express-serve-static-core" {
    interface ParamsDictionary {
        [key /*@Unsafe*/: string]: string;
    }
}

declare module "express" {
    interface MySome{}
    interface MParamsDictionary {
        [key /*@Unsafe*/: string]: string;
    }

    interface Request<
        P = MParamsDictionary,
        ResBody = any,
        ReqBody = any,
        ReqQuery = core.Query,
        Locals extends Record<string, any> = Record<string, any>
    > extends core.Request<P, ResBody, ReqBody, ReqQuery, Locals> {}

}

declare global {
    namespace NodeJS {
        interface Process extends EventEmitter {
            env: {
                [key/*@Unsafe*/: string]: string
            };
        }
    }
}