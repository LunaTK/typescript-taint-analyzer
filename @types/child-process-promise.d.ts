import * as cpp from 'child-process-promise';
import {
    ExecOptions
} from 'child_process';

declare module 'child-process-promise' {
    export function exec(
        command /*@Safe*/: Readonly<string>,
        options: Readonly<Options & { encoding: "buffer" | null } & ExecOptions>
    ): ChildProcessPromise<PromiseResult<Buffer>>;
}