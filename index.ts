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
        flowsTo?: ES6Set<FlowInfo>;
        isExternal?: boolean;
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

// const filePath = './samples/davros.ts';
// const filePath = './samples/example1.ts';
const filePath = './samples/server-examples.ts';
const program = ts.createProgram([filePath], options);
const checker = program.getTypeChecker();
const printer = ts.createPrinter();

const log = logger({
    prefix: function (level) {
        return `[${level}]`
    },
    level: 'trace'
});

let analysisResult = {
    totalFlow: 0,
    totalPropagation: 0,
    detectedViolation: []
}

function delint(sourceFiles: ts.SourceFile[]) {
    sourceFiles.forEach(sourceFile => {
        let origins = 1;
        if (program.isSourceFileFromExternalLibrary(sourceFile)
            || program.isSourceFileDefaultLibrary(sourceFile)) {
            origins = 0;
            origins |= program.isSourceFileFromExternalLibrary(sourceFile) ? 2 : 0;
            origins |= program.isSourceFileDefaultLibrary(sourceFile) ? 4 : 0;
    
            sourceFile.isExternal = true;
        }
        ts.forEachChild(sourceFile, visitAndApplySafety);
    });
    
    sourceFiles.forEach(sourceFile => { 
        if (!sourceFile.isExternal) {
            console.log('Visiting :', sourceFile.fileName);    
            ts.forEachChild(sourceFile, visitAndCheckRules);
        }
    })
   

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
        log.trace(`${getNodeLoc(node)}: getIdentifierSafety`);
        const symbol = getSymbolAtLocation(node);
        const symbolSafety = getSymbolSafety(symbol);

        //? explicitSafety가 있으면 그걸, 없으면 Declaration에 있는걸 리턴
        // return explicitSafety || symbolSafety;
        return symbolSafety;
    }

    function getSymbolAtLocation(node: ts.Node): ts.Symbol {
        log.trace(`${getNodeLoc(node)}: getSymbolAtLocation`)
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
            //? 아마 any 타입, exports 심볼인듯
            log.error(`Failed to resolve symbol`)  
        } else if (ts.isTransientSymbol(symbol)) {
            //TODO: for-loop로 최적화
            if (!symbol.target) return symbol;
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
            if (ts.isCallExpression(expression)) {
                const signature = checker.getResolvedSignature(expression);
                const returnType = signature.getReturnType();
                const info = checker.getIndexInfoOfType(returnType, ts.IndexKind.String);
                if (!info) return null; //! any타입에 접근한것으로 가정
                const identifier = info.declaration.parameters[0].name;
                return checker.getSymbolAtLocation(identifier);
            } else if (ts.isPropertyAccessExpression(expression)) {
                symbol = getRightmostSymbol(expression);
            } else {
                symbol = checker.getSymbolAtLocation(expression);
            }
            if (!symbol) return null; //! 대상이 Any 타입
            const symbolType = checker.getTypeOfSymbolAtLocation(symbol, expression);
            //! 현재는 String Index만 고려, Number는 고려하지 않음
            const info = checker.getIndexInfoOfType(symbolType, ts.IndexKind.String);
            if (!info) return null; //! Index Signature가 없으면 any타입에 접근한것으로 가정
            const identifier = info.declaration.parameters[0].name;
            return checker.getSymbolAtLocation(identifier);
        }
        return symbol;
    }

    function getSymbolsInExpr(expr: ts.Expression): Set<ts.Symbol> {
        let symbols = new Set<ts.Symbol>();
        if (ts.isParenthesizedExpression(expr)) {
            symbols = getSymbolsInExpr(expr.expression);
        } else if (ts.isTemplateExpression(expr)) {
            expr.templateSpans.forEach(spans => {
                addAll(getSymbolsInExpr(spans.expression));
            });
        } else if (ts.isElementAccessExpression(expr)) {
            //? Element Access는 어떤 필드일지 모르니 모든 심볼과 연결
            const target = expr.expression;
            const type = checker.getTypeAtLocation(target);
            type.getProperties().forEach(prop => symbols.add(prop));
        } else if (ts.isElementAccessChain(expr)) {

        } else if (ts.isIdentifier(expr)) {
            symbols.add(getSymbolAtLocation(expr));
        } else if (ts.isBinaryExpression(expr)) {
            // TODO: BinaryExpression 모든 경우를 커버하는지 확인
            // TODO: Ternary도 고려하자
            addAll(getSymbolsInExpr(expr.left));
            addAll(getSymbolsInExpr(expr.right));
        } else if (ts.isCallExpression(expr)) {
            //TODO: 현재 String 멤버 함수(ex. replace) 호출만 고려
            const expression = expr.expression; //? 호출 대상
            addAll(getSymbolsInExpr(expression));
            if (ts.isPropertyAccessExpression(expression)) {
                addAll(getSymbolsInExpr(expression.expression)); //TODO: String replace 체이닝때문에 한건데 그외경우는 안발생하나?
                const type = checker.getTypeAtLocation(expression.expression);
                if (type && type.flags & ts.TypeFlags.StringLike) {
                    expr.arguments.forEach(arg => {
                        addAll(getSymbolsInExpr(arg));
                    });
                }
            }
        } else if (ts.isFunctionExpression(expr)) {
            //TODO: 함수 시그니쳐의 flows도 연결해야하지 않을까?
        }else if (ts.isObjectLiteralExpression(expr)) {
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

        function addAll(source: Set<ts.Symbol>) {
            source.forEach(ele => symbols.add(ele));
        }
    }

    function isCallExpressionUnsafe(callExpr: ts.CallExpression) {
        const signature = checker.getResolvedSignature(callExpr);
        if (getSignatureSafety(signature) === Safety.Unsafe) 
            return true;
        return false;
    }
    
    type DeclarationWithSafety = 
        ts.VariableDeclaration | 
        ts.ParameterDeclaration | //? 함수 파라미터, 인덱스 시그니쳐 파라미터
        ts.PropertyDeclaration | //? Class 프로퍼티 선언
        ts.PropertyAssignment | //? Object Literal 프로퍼티 선언
        ts.PropertySignature | //? Interface 프로퍼티 선언
        ts.FunctionDeclaration; 

    function isDeclarationWithSafety(node: ts.Node): node is DeclarationWithSafety {
        return ts.isVariableDeclaration(node) ||
            ts.isParameter(node) ||
            ts.isPropertyAssignment(node) || 
            ts.isPropertyDeclaration(node) || 
            ts.isPropertySignature(node) ||
            ts.isFunctionDeclaration(node); 
    }

    function applyExplicitSafety(node: DeclarationWithSafety) { 
        const name = node.name;
        const symbol = checker.getSymbolAtLocation(name);
        if (symbol) {
            symbol.isExternal ||= node.getSourceFile().isExternal;
            // TODO: name은 Identifier나 BindingExpression 가능, 현재는 Identifier만 지원
            // if (name.kind === ts.SyntaxKind.Identifier) {
                const explicitSafety = getExplicitSafety(name as ts.Identifier);
                
                if (explicitSafety !== null) {
                    log.info(`${getNodeLoc(name)}: Symbol "${symbol.name}" is declared to be ${explicitSafety}`)
                    setSymbolSafety(symbol, explicitSafety);
                    if (explicitSafety === Safety.Unsafe)
                        propagateUnsafety({
                            symbol,
                            node: name,
                        }, symbol, name);
                }
            // }
        }
    }

    function connectSafetyFlow(targetNode: ts.Node, sourceNode: ts.Node, target: ts.Symbol, source: ts.Symbol) {
        if (!target || ! source) return;
        if (target === source) return;
        log.debug(`${getNodeLoc(targetNode)}: Connect safety flow from ${source.name}`);
        analysisResult.totalFlow += 1;
        if (!source.flowsTo) source.flowsTo = new Set();
        // const target = getSymbolAtLocation(targetNode);
        const newFlow = { symbol: target, node: targetNode };
        source.flowsTo.add(newFlow);

        if (source.safety === Safety.Unsafe)
            propagateUnsafety(newFlow, source, sourceNode);
    }

    function propagateUnsafety(target: ts.FlowInfo, source: ts.Symbol, sourceNode: ts.Node) {
        if (target.symbol.safety === Safety.Safe) {
            report(sourceNode, 
                `Unsafe "${source?.name}" flows to ${target.symbol.name}`);
            analysisResult.totalPropagation += 1;
            return;
        }

        if (target.symbol.isExternal) return;

        log.debug(`${getNodeLoc(target.node)}: Unsafety propagated from ${source.name}`);
        setSymbolSafety(target.symbol, Safety.Unsafe);
        analysisResult.totalPropagation += 1;

        target.symbol.flowsTo?.forEach((flowInfo) => {
            propagateUnsafety(flowInfo, target.symbol, target.node);
        });
    }

    function visitAndApplySafety(node: ts.Node) {
        if (isDeclarationWithSafety(node)) {
            applyExplicitSafety(node);
        }
        ts.forEachChild(node, visitAndApplySafety);
    }
    
    function visitAndCheckRules(node: ts.Node) {
        if (isDeclarationWithSafety(node) 
            && !ts.isFunctionDeclaration(node) 
            && node.initializer) {
            const target = node.name;
            const source = node.initializer;

            if (ts.isIdentifier(target)) {
                //TODO: target이 Identifier가 아닌 경우 있는지 확인
                const explicitSafety = getExplicitSafety(source);
                if (!explicitSafety) { //? Inference & Propagation
                    const symbols = getSymbolsInExpr(source);
                    const targetSymbol = getSymbolAtLocation(target);
    
                    symbols.forEach(symbol => {
                        connectSafetyFlow(target, source, targetSymbol, symbol);
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
                    connectSafetyFlow(target, source, targetSymbol, symbol);
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

            if (signature.safety === Safety.Safe) return; //? Explicit Safety있으면 생략

            const expr = node.expression;
            const explicitSafety = getExplicitSafety(expr);
            if (!explicitSafety) {
                const symbols = getSymbolsInExpr(expr);

                symbols.forEach(symbol => {
                    // TODO : connectSafetyFlow 함수버전 구현하기
                    setSignatureSafety(signature, Safety.Unsafe);
                    log.info(`${getNodeLoc(funcDeclaration)}: Signature of function "${funcDeclaration.name?.getText()}" is Unsafe`);
                });
            } else if (explicitSafety === Safety.Unsafe) {
                setSignatureSafety(signature, Safety.Unsafe);
                log.info(`${getNodeLoc(funcDeclaration)}: Signature of function "${funcDeclaration.name?.getText()}" is Unsafe`);
            }
        } else if (ts.isCallExpression(node)) {
            //* CallLikeExpression 은 new 도 포함, 여기선 고려하지 않음
            const signature = checker.getResolvedSignature(node);
            if (signature) {
                const params = signature.parameters;
                const args = node.arguments;
        
                args.forEach((arg, i) => {
                    const explicitSafety = getExplicitSafety(arg);
                    if (!explicitSafety) {
                        const symbols = getSymbolsInExpr(arg);
                        symbols.forEach(symbol => {
                            connectSafetyFlow(params[i]?.valueDeclaration, arg, params[i], symbol);
                        });
                    } else if (explicitSafety === Safety.Unsafe && params[i].safety === Safety.Safe) {
                        report(arg, `Unsafe assignment`);
                    }
                });
            }
        }

        ts.forEachChild(node, visitAndCheckRules); 
    }

    function getNodeLoc(node: ts.Node) {
        const { line, character } = node.getSourceFile().getLineAndCharacterOfPosition(node.getStart());
        return `${node.getSourceFile().fileName} (${line + 1},${character + 1})`;
    }

    function report(node: ts.Node, message: string) {
        log.info(`${getNodeLoc(node)}: ${message}`);
        analysisResult.detectedViolation.push(`${getNodeLoc(node)}: ${message}`);
    }
}

delint(program.getSourceFiles() as ts.SourceFile[]);

console.table(analysisResult.detectedViolation);
console.log(`# Total Flow        : ${analysisResult.totalFlow}`);
console.log(`# Total Propagation : ${analysisResult.totalPropagation}`);
console.log(`# Total Violation   : ${analysisResult.detectedViolation.length}`);