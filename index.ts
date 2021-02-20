import * as ts from 'byots';
import * as logger from "console-log-level";

enum Safety {
    Safe = "Safe",
    Unsafe = "Unsafe",
    Maybe = "Maybe",
}

type ES6Set<T> = Set<T>;

declare module 'byots' {
    interface SourceFile {
        isExternal?: boolean;
    }

    interface FlowInfo {
        symbol: ts.Symbol;
        node: ts.Node;
    }

    interface SafetyContainer {
        safety: Safety;
        flowsTo?: ES6Set<FlowInfo>
    }

    interface Symbol extends SafetyContainer {}

    interface Signature extends SafetyContainer{}
}

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
    level: 'trace'
});

function delint(sourceFile: ts.SourceFile) {
    ts.forEachChild(sourceFile, visitAndApplySafety);
    ts.forEachChild(sourceFile, visitAndCheckRules);

    function setSymbolSafety(symbol: ts.Symbol, safety: Safety) {
        symbol.safety = safety;
    }
    
    function getSymbolSafety(symbol: ts.Symbol): Safety {
        return symbol.safety;
    }
    
    function setSignatureSafety(signature: ts.Signature, safety: Safety) {
        signature.safety = safety;
    }
    
    function getSignatureSafety(signature: ts.Signature) {
        return signature.safety;
    }

    function getExplicitSafety(node: ts.Node): Safety | null {
        const sourceText = node.getSourceFile().text;
        const trailingComments = ts.getTrailingCommentRanges(sourceText, node.getFullStart() + node.getFullWidth());
    
        for (let cr of trailingComments || []) {
            if (cr.kind === ts.SyntaxKind.MultiLineCommentTrivia) {
                const content = sourceText.substring(cr.pos+2, cr.end-2).trim();
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
        log.debug(`${getNodeLoc(node)}: getIdentifierSafety`);
        const symbol = getSymbolAtLocation(node);
        const symbolSafety = getSymbolSafety(symbol);

        //? explicitSafety가 있으면 그걸, 없으면 Declaration에 있는걸 리턴
        // return explicitSafety || symbolSafety;
        return symbolSafety;
    }

    function getSymbolAtLocation(node: ts.Node): ts.Symbol {
        log.debug(`${getNodeLoc(node)}: getSymbolAtLocation`)
        const symbol = checker.getSymbolAtLocation(node);
        if (ts.isIdentifier(node))
            return getRootSymbol(symbol, node);
        
        return getRootSymbol(symbol);
    }

    function getRootSymbol(symbol: ts.Symbol, node?: ts.Identifier): ts.Symbol {
        if (!symbol && node) {
            //TODO: 지금은 Index Signature 접근인 경우라고만 생각, 다른경우 있는지 확인
            log.debug(`Empty symbol detected, assuming it as IndexSignature`);

            const parent = node.parent;

            if (ts.isPropertyAccessExpression(parent)) {
                const rightmostSymbol = getRightmostSymbol(parent);
                return rightmostSymbol;
            }
            log.warn(`${getNodeLoc(parent)}: Index Signature resolve failed`);
            return symbol;
        } else if (!symbol) {
            log.error(`Failed to resolve symbol`)  
        } else if (ts.isTransientSymbol(symbol)) {
            //TODO: for-loop로 최적화
            return getRootSymbol(symbol.target);
        } else if (symbol.flags & ts.SymbolFlags.Alias) {
            return checker.getAliasedSymbol(symbol);
        }

        return symbol;
    }

    function getRightmostSymbol(expr: ts.PropertyAccessExpression): ts.Symbol {
        const expression = expr.expression; // LHS
        const name = expr.name; //RHS
        let symbol = checker.getSymbolAtLocation(name);
        if (!symbol) {
            //TODO: 지금은 Index Signature 접근인 경우라고만 생각, 다른경우 있는지 확인
            if (ts.isPropertyAccessExpression(expression)) {
                symbol = getRightmostSymbol(expression);
            } else {
                symbol = checker.getSymbolAtLocation(expression);
            }
            const symbolType = checker.getTypeOfSymbolAtLocation(symbol, expression);
            //! 현재는 String Index만 고려, Number는 고려하지 않음
            const info = checker.getIndexInfoOfType(symbolType, ts.IndexKind.String);
            const identifier = info.declaration.parameters[0].name;
            return checker.getSymbolAtLocation(identifier);
        }
        return symbol;
    }

    function getSymbolsInExpr(expr: ts.Expression): Set<ts.Symbol> {
        let symbols = new Set<ts.Symbol>();
        if (ts.isElementAccessExpression(expr)) {

        } else if (ts.isElementAccessChain(expr)) {

        } else if (ts.isIdentifier(expr)) {
            symbols.add(getSymbolAtLocation(expr));
        } else if (ts.isBinaryExpression(expr)) {
            // TODO: BinaryExpression 모든 경우를 커버하는지 확인
            // TODO: Ternary도 고려하자
            getSymbolsInExpr(expr.left).forEach(s => symbols.add(s));
            getSymbolsInExpr(expr.right).forEach(s => symbols.add(s));
        } else if (ts.isCallExpression(expr)) {
            //TODO: 함수 호출은 따로 처리
            const signature = checker.getResolvedSignature(expr);
            // return getSignatureSafety(signature) === Safety.Unsafe;
        } else if (ts.isObjectLiteralExpression(expr)) {
            for (const prop of expr.properties) {
                symbols.add(prop.symbol);
            }
        } else if (ts.isPropertyAccessExpression(expr)) {
            if (ts.isIdentifier(expr.name))
                symbols = getSymbolsInExpr(expr.name);
            else //* PrivateIdentifier는 어차피 액세스 불가이니 취급안함
                ;
        } else if (ts.isLiteralKind(expr.kind)) {
            //* Literal은 Symbol 없음
        }
        return symbols;
    }

    function isCallExpressionUnsafe(callExpr: ts.CallExpression) {
        const signature = checker.getResolvedSignature(callExpr);

        if (getSignatureSafety(signature) === Safety.Unsafe) 
            return true;
        return false;
    }
    
/*  function isExpressionUnsafe(expr: ts.Expression): boolean {
        const explicitSafety = getExplicitSafety(expr);
        if (explicitSafety) {
            if (explicitSafety === Safety.Unsafe) return true;
            else return false;
        }
        const isUnsafeByRule = (() => {
            if (ts.isElementAccessExpression(expr) || ts.isElementAccessChain(expr)) {

            } else if (ts.isIdentifier(expr)) {
                return getIdentifierSafety(expr) === Safety.Unsafe;
            } else if (ts.isBinaryExpression(expr)) {
                // TODO: BinaryExpression 모든 경우를 커버하는지 확인
                // TODO: Ternary도 고려하자
                return isExpressionUnsafe(expr.left) || isExpressionUnsafe(expr.right);
            } else if (ts.isCallExpression(expr)) {
                const signature = checker.getResolvedSignature(expr);
                return getSignatureSafety(signature) === Safety.Unsafe;
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
    } */
    
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

    function applyExplicitSafety(node: DeclarationWithSafety) { 
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

    function connectSafetyFlow(targetNode: ts.Node, target: ts.Symbol, source: ts.Symbol) {
        log.trace(`${getNodeLoc(targetNode)}: Connect safety flow from ${source.name}`);
        if (!source.flowsTo) source.flowsTo = new Set();
        // const target = getSymbolAtLocation(targetNode);
        const newFlow = { symbol: target, node: targetNode };
        source.flowsTo.add(newFlow);

        if (source.safety === Safety.Unsafe)
            propagateUnsafety(newFlow, source);
    }

    function propagateUnsafety(target: ts.FlowInfo, source: ts.Symbol) {
        if (target.symbol.safety === Safety.Safe) {
            report(target.node, 
                `Unsafe "${source?.name}" flows to ${target.symbol.name}`);
            return;
        }
        log.trace(`${getNodeLoc(target.node)}: Unsafety propagated from ${source.name}`);
        setSymbolSafety(target.symbol, Safety.Unsafe);

        target.symbol.flowsTo?.forEach((flowInfo) => {
            propagateUnsafety(flowInfo, target.symbol);
        });
    }

    function visitAndApplySafety(node: ts.Node) {
        if (isDeclarationWithSafety(node)) {
            applyExplicitSafety(node);
        }
        ts.forEachChild(node, visitAndApplySafety);
    }
    
    function visitAndCheckRules(node: ts.Node) {
        if (isDeclarationWithSafety(node) && node.initializer) {
            const target = node.name;
            const source = node.initializer;

            if (ts.isIdentifier(target)) {
                //TODO: target이 Identifier가 아닌 경우 있는지 확인
                const explicitSafety = getExplicitSafety(source);
                if (!explicitSafety) { //? Inference & Propagation
                    const symbols = getSymbolsInExpr(source);
                    const targetSymbol = getSymbolAtLocation(target);
    
                    symbols.forEach(symbol => {
                        connectSafetyFlow(target, targetSymbol, symbol);
                    });
                } else if (explicitSafety === Safety.Unsafe && getIdentifierSafety(target) === Safety.Safe) {
                    report(node, `Unsafe assignment`);
                }
            }
        } else if (ts.isAssignmentExpression(node)) {
            const target = node.left;
            const source = node.right;
            const targetSymbol = getSymbolAtLocation(target);

            const explicitSafety = getExplicitSafety(source);
            if (!explicitSafety) {
                const symbols = getSymbolsInExpr(source);
    
                symbols.forEach(symbol => {
                    connectSafetyFlow(target, targetSymbol, symbol);
                });
            } else if (explicitSafety === Safety.Unsafe && targetSymbol.safety === Safety.Safe) {
                report(node, `Unsafe assignment`);
            }
        } else if (ts.isFunctionDeclaration(node)) {
            //TODO: 함수 시그니쳐에 Explicit Safety 있는지
        } else if (ts.isReturnStatement(node)) {
            //* 리턴 값 중 Unsafe가 있으면 함수도 Unsafe
            const funcDeclaration = ts.getContainingFunctionDeclaration(node);
            const signature = checker.getSignatureFromDeclaration(funcDeclaration);

            const expr = node.expression;
            const explicitSafety = getExplicitSafety(expr);
            if (!explicitSafety) {
                const symbols = getSymbolsInExpr(expr);

                symbols.forEach(symbol => {
                    // TODO : connectSafetyFlow 함수버전 구현하기
                    setSignatureSafety(signature, Safety.Unsafe);
                    log.info(`${getNodeLoc(funcDeclaration)}: Signature of function "${funcDeclaration.name.getText()}" is Unsafe`);
                });
            } else if (explicitSafety === Safety.Unsafe) {
                setSignatureSafety(signature, Safety.Unsafe);
                log.info(`${getNodeLoc(funcDeclaration)}: Signature of function "${funcDeclaration.name.getText()}" is Unsafe`);
            }
        } else if (ts.isCallExpression(node)) {
            //* CallLikeExpression 은 new 도 포함, 여기선 고려하지 않음
            const signature = checker.getResolvedSignature(node);
            const params = signature.parameters;
            const args = node.arguments;
    
            args.forEach((arg, i) => {
                const explicitSafety = getExplicitSafety(arg);
                if (!explicitSafety) {
                    const symbols = getSymbolsInExpr(arg);
                    symbols.forEach(symbol => {
                        connectSafetyFlow(params[i].valueDeclaration, params[i], symbol);
                    });
                } else if (explicitSafety === Safety.Unsafe && params[i].safety === Safety.Safe) {
                    report(arg, `Unsafe assignment`);
                }
            });
        }

        ts.forEachChild(node, visitAndCheckRules); 
    }

    function getNodeLoc(node: ts.Node) {
        const { line, character } = node.getSourceFile().getLineAndCharacterOfPosition(node.getStart());
        return `${node.getSourceFile().fileName} (${line + 1},${character + 1})`;
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

        file.isExternal = true;
    }

    if (!file.isExternal) {
        // if codebase file
        console.log('Visiting :', file.fileName);
        delint(file);
    }
    // console.log(origins, (<any>file).origins, file.path);
});
