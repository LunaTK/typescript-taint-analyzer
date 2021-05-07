function query(sql /*@Safe*/: string) {
    // do some query stuff here
}

const userInput /*@Unsafe*/ = 'some unsafe string';

query(userInput);