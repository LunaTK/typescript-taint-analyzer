import * as mysql from "mysql2";

const unsafeString /*@Unsafe*/ = "";

const test = {
    getEnv: function test() {
        return process.env;
    },
    unsafeString: process.env.UPLOADED_FILES_DIR
}

const uploadedFilesPath = test.getEnv().UPLOADED_FILES_DIR;
mysql.createConnection(uploadedFilesPath);