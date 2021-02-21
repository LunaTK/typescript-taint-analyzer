import * as mysql from "mysql2";

const test = {
    getEnv: function() {
        return process.env;
    },
    unsafeString: process.env.UPLOADED_FILES_DIR
} 

const { unsafeString } = test;

const uploadedFilesPath = test.getEnv().UPLOADED_FILES_DIR;
mysql.createConnection(uploadedFilesPath);