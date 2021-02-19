import * as ts from 'byots';
import * as logger from "console-log-level";

const options = {
    allowJs: true,
    declaration: true,
    noEmitOnError: true,
    noImplicitAny: true,
    target: ts.ScriptTarget.ES5,
    module: ts.ModuleKind.CommonJS
};

const filePath = './samples/example1.ts';
// const filePath = './samples/example3.ts';
const program = ts.createProgram([filePath], options);
const checker = program.getTypeChecker();
const printer = ts.createPrinter();

const log = logger({
    prefix: function (level) {
        return `[${level}]`
    },
    level: 'debug'
});

enum Safety {
    Safe = "Safe",
    Unsafe = "Unsafe",
    Maybe = "Maybe",
}

function delint(sourceFile: ts.SourceFile) {
    ts.forEachChild(sourceFile, visitAndApplySafety);
    ts.forEachChild(sourceFile, visitAndCheckRules);

    function setSymbolSafety(symbol: ts.Symbol, safety: Safety) {
        (symbol as any).safety = safety;
    }
    
    function getSymbolSafety(symbol: ts.Symbol): Safety {
        return (symbol as any).safety;
    }
    
    function setSignatureSafety(signature: ts.Signature, safety: Safety) {
        (signature as any).safety = safety;
    }
    
    function getSignatureSafety(signature: ts.Signature) {
        return (signature as any).safety;
    }

    function getExplicitSafety(node: ts.Node): Safety | null {
        const trailingComments = ts.getTrailingCommentRanges(sourceFile.text, node.getFullStart() + node.getFullWidth());
    
        for (let cr of trailingComments || []) {
            if (cr.kind === ts.SyntaxKind.MultiLineCommentTrivia) {
                const content = sourceFile.text.substring(cr.pos+2, cr.end-2).trim();
                if (content === '@' + Safety.Unsafe) {
                    return Safety.Unsafe;
                } else if (content === '@' + Safety.Safe) {
                    return Safety.Safe;
                }
            }
        }
        return null;
    }
    
    function getIdentifierSafety(node: ts.Identifier): Safety | null {
        // const explicitSafety = getExplicitSafety(node);
        const symbol = getRootSymbol(checker.getSymbolAtLocation(node));
        const symbolSafety = getSymbolSafety(symbol);

        //? explicitSafety가 있으면 그걸, 없으면 Declaration에 있는걸 리턴
        // return explicitSafety || symbolSafety;
        return symbolSafety;
    }

    function getRootSymbol(symbol: ts.Symbol): ts.Symbol {
        if (!symbol) {
            log.warn(`Empty symbol detected`);
            return symbol;
        }

        if (ts.isTransientSymbol(symbol)) {
            //TODO: for-loop로 최적화
            return getRootSymbol(symbol.target);
        } else if (symbol.flags & ts.SymbolFlags.Alias) {
            return checker.getAliasedSymbol(symbol);
        }
        return symbol;
    }
    
    function isExpressionUnsafe(expr: ts.Expression): boolean {
        const explicitSafety = getExplicitSafety(expr);
        if (explicitSafety) {
            if (explicitSafety === Safety.Unsafe) return true;
            else return false;
        }
        const isUnsafeByRule = (() => {
            if (ts.isElementAccessExpression(expr)) {

            } else if (ts.isElementAccessChain(expr)) {
    
            } else if (ts.isIdentifier(expr)) {
                return getIdentifierSafety(expr) === Safety.Unsafe;
            } else if (ts.isBinaryExpression(expr)) {
                // TODO: BinaryExpression 모든 경우를 커버하는지 확인
                return isExpressionUnsafe(expr.left) || isExpressionUnsafe(expr.right);
            } else if (ts.isCallExpression(expr)) {
                const signature = checker.getResolvedSignature(expr);
                return getSignatureSafety(signature);
            } else if (ts.isObjectLiteralExpression(expr)) {
                //* Unsafe 프로퍼티가 하나라도 있으면
                for (const prop of expr.properties) {
                    if (getSymbolSafety(prop.symbol) === Safety.Unsafe) return true;
                }
                return false;
            } else if (ts.isPropertyAccessExpression(expr)) {
                if (ts.isIdentifier(expr.name))
                    return isExpressionUnsafe(expr.name);
                else //* PrivateIdentifier는 어차피 액세스 불가이니 취급안함
                    return false;
            } else if (ts.isLiteralKind(expr.kind)) {
                //* Literal은 모두 Safe
                return false;
            }
            log.debug(`${getNodeLoc(expr)}: Unhandled expression safety of ${expr.getText()}`);
            return false;
        })();
        return isUnsafeByRule;
    }
    
    type DeclarationWithSafety = 
        ts.VariableDeclaration | 
        ts.ParameterDeclaration | //? 함수 파라미터, 인덱스 시그니쳐 파라미터
        ts.PropertyDeclaration | //? Class 프로퍼티 선언
        ts.PropertyAssignment | //? Object Literal 프로퍼티 선언
        ts.PropertySignature; //? Interface 프로퍼티 선언

    function isDeclarationWithSafety(node: ts.Node): node is DeclarationWithSafety {
        return ts.isVariableDeclaration(node) ||
            ts.isParameter(node) ||
            ts.isPropertyAssignment(node) || 
            ts.isPropertyDeclaration(node) || 
            ts.isPropertySignature(node); 
    }

    function applyDeclaredSafety(node: DeclarationWithSafety) { 
        const name = node.name;
        const symbol = checker.getSymbolAtLocation(name);
        if (symbol) {
            // TODO: name은 Identifier나 BindingExpression 가능, 현재는 Identifier만 지원
            if (name.kind === ts.SyntaxKind.Identifier) {
                const explicitSafety = getExplicitSafety(name as ts.Identifier);
    
                if (explicitSafety !== null) {
                    log.info(`${getNodeLoc(name)}: Symbol "${symbol.name}" is declared to be ${explicitSafety}`)
                    setSymbolSafety(symbol, explicitSafety);
                }
            }
        }
    }
    
    const syntaxToKind = (kind: ts.Node["kind"]) => {
        return ts.SyntaxKind[kind];
    }

    function visitAndApplySafety(node: ts.Node) {
        if (isDeclarationWithSafety(node)) {
            applyDeclaredSafety(node);
        }
        ts.forEachChild(node, visitAndApplySafety);
    }
    
    function visitAndCheckRules(node: ts.Node) {
        if (isDeclarationWithSafety(node) && node.initializer) {
            const target = node.name;
            const source = node.initializer;

            if (ts.isIdentifier(target)) {
                //TODO: target이 Identifier가 아닌 경우 확인
                if (isExpressionUnsafe(source) && !isExpressionUnsafe(target)) {
                    report(node, `Unsafe assignment`);
                }
            }
        } else if (ts.isAssignmentExpression(node)) {
            const target = node.left;
            const source = node.right;
    
            if (isExpressionUnsafe(source) && !isExpressionUnsafe(target)) {
                report(node, `Unsafe assignment`);
            }
        } else if (ts.isFunctionDeclaration(node)) {
            //TODO: 함수 시그니쳐에 Explicit Safety 있는지
        } else if (ts.isReturnStatement(node)) {
            //* 리턴 값 중 Unsafe가 있으면 함수도 Unsafe
            const funcDeclaration = ts.getContainingFunctionDeclaration(node);
            const signature = checker.getSignatureFromDeclaration(funcDeclaration);

            const expr = node.expression;

            if (isExpressionUnsafe(expr)) {
                log.info(`${getNodeLoc(funcDeclaration)}: Signature of function "${funcDeclaration.name.getText()}" is Unsafe`);
                setSignatureSafety(signature, Safety.Unsafe);
            }
        } else if (ts.isCallExpression(node)) {
            //* CallLikeExpression 은 new 도 포함, 여기선 고려하지 않음
            const signature = checker.getResolvedSignature(node);
            const params = signature.parameters;
            const args = node.arguments;
    
            args.forEach((arg, i) => {
                if (isExpressionUnsafe(arg) && getSymbolSafety(params[i]) !== Safety.Unsafe) {
                    report(arg, `Unsafe argument pass`);
                }
            });
        }

        ts.forEachChild(node, visitAndCheckRules); 
    }

    function getNodeLoc(node: ts.Node) {
        const { line, character } = sourceFile.getLineAndCharacterOfPosition(node.getStart());
        return `${sourceFile.fileName} (${line + 1},${character + 1})`;
    }

    function report(node: ts.Node, message: string) {
        console.log(`${getNodeLoc(node)}: ${message}`);
    }
}

program.getSourceFiles().forEach((file) => {
    // console.log(file.fileName);
    let origins = 1;
    if (program.isSourceFileFromExternalLibrary(file)
        || program.isSourceFileDefaultLibrary(file)) {
        origins = 0;
        origins |= program.isSourceFileFromExternalLibrary(file) ? 2 : 0;
        origins |= program.isSourceFileDefaultLibrary(file) ? 4 : 0;
    }

    if ((<any>file).origins === 1) {
        // if codebase file
        console.log('Visiting :', file.fileName);
        delint(file);
    }
    // console.log(origins, (<any>file).origins, file.path);
});
