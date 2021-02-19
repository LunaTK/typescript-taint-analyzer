let myString: string = 'someThing';

let myString2 /*@Unsafe*/ : string = myString;

myString = "aa" + myString2 /*@Safe*/;

function someFun(a /*@Safe*/: string) {
    return a;
}

function someFun2(a /*@Unsafe*/) {
    return a;
}

someFun(someFun2(myString2));