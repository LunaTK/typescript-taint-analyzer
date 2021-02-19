import * as mysql from "mysql2";

declare module "mysql2" {
    function createConnection(connectionUri /*@Safe*/: string): string;
}