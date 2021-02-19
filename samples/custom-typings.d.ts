import * as mysql from "mysql2";

declare module "mysql2" {
    function createConnection(connectionUri /*@Safe*/: string): string;
}

declare global {
    namespace NodeJS {
        interface Process extends EventEmitter {
            env: {
                [key: string]: string
            };
        }
    }
}