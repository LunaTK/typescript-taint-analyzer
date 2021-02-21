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
        container: SafetyContainer;
        node: ts.Node;
    }

    interface ISafetyContainer {
        safety: Safety;
        flowsTo?: ES6Set<FlowInfo>;
        isExternal?: boolean;
    }

    interface Symbol extends ISafetyContainer {}

    interface Signature extends ISafetyContainer{}

    type SafetyContainer = Symbol | Signature;
}

const options = {
    allowJs: true,
    declaration: true,
    noEmitOnError: true,
    noImplicitAny: true,
    target: ts.ScriptTarget.ES5,
    module: ts.ModuleKind.CommonJS
};

// const filePath = './samples/example1.ts';
// const filePath = './samples/davros.ts';
// const filePath = './samples/server-examples.ts';
// const filePath = './samples/fakeApi.ts';
const filePath = './samples/stackable.ts';
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
        if (program.isSourceFileFromExternalLibrary(sourceFile)
            || program.isSourceFileDefaultLibrary(sourceFile)) {
    
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
   

    function setContainerSafety(container: ts.SafetyContainer, safety: Safety) {
        container.safety = safety;
    }
    
    function getContainerSafety(container: ts.SafetyContainer): Safety {
        return container.safety;
    }
    
    function getContainerDisplayName(container: ts.SafetyContainer): string {
        if (isSymbol(container)) {
            return container.name;
        } else {
            return container.declaration?.getText();
        }

        function isSymbol(c: ts.SafetyContainer): c is ts.Symbol {
            return !!((c as any).name);
        }
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
        const symbolSafety = getContainerSafety(symbol);

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

    function getSafetyContainersInExpr(expr: ts.Expression): Set<ts.SafetyContainer> {
        let containers = new Set<ts.SafetyContainer>();
        if (ts.isParenthesizedExpression(expr)) {
            containers = getSafetyContainersInExpr(expr.expression);
        } else if (ts.isTemplateExpression(expr)) {
            expr.templateSpans.forEach(spans => {
                addAll(getSafetyContainersInExpr(spans.expression));
            });
        } else if (ts.isElementAccessExpression(expr)) {
            //? Element Access는 어떤 필드일지 모르니 모든 심볼과 연결
            const target = expr.expression;
            const type = checker.getTypeAtLocation(target);
            type.getProperties().forEach(prop => containers.add(prop));
        } else if (ts.isElementAccessChain(expr)) {

        } else if (ts.isIdentifier(expr)) {
            containers.add(getSymbolAtLocation(expr));
        } else if (ts.isBinaryExpression(expr)) {
            // TODO: BinaryExpression 모든 경우를 커버하는지 확인
            // TODO: Ternary도 고려하자
            addAll(getSafetyContainersInExpr(expr.left));
            addAll(getSafetyContainersInExpr(expr.right));
        } else if (ts.isCallExpression(expr)) {
            //TODO: 현재 String 멤버 함수(ex. replace) 호출만 고려
            const expression = expr.expression; //? 호출 대상
            const signature = checker.getResolvedSignature(expr);
            if (ts.isPropertyAccessExpression(expression)) { //! String에 대한 연산
                const type = checker.getTypeAtLocation(expression.expression);
                if (type && type.flags & ts.TypeFlags.StringLike) {
                    addAll(getSafetyContainersInExpr(expression));
                    addAll(getSafetyContainersInExpr(expression.expression)); //TODO: String replace 체이닝때문에 한건데 그외경우는 안발생하나?
                    expr.arguments.forEach(arg => {
                        addAll(getSafetyContainersInExpr(arg));
                    });
                }
            }
            const declaration = signature.getDeclaration();
            if (declaration && (declaration.flags & ts.NodeFlags.Ambient || declaration.getSourceFile().isExternal)) {
                //? 외부 함수는 argument로 연결
                expr.arguments.forEach(arg => {
                    addAll(getSafetyContainersInExpr(arg));
                });
            } else if (signature) {
                //? 내부 함수는 signature로 연결
                containers.add(signature);
            }
        } else if (ts.isFunctionExpression(expr)) {
            //TODO: 함수 시그니쳐의 flows도 연결해야하지 않을까?
        }else if (ts.isObjectLiteralExpression(expr)) {
            for (const prop of expr.properties) {
                containers.add(prop.symbol);
            }
        } else if (ts.isPropertyAccessExpression(expr)) {
            if (ts.isIdentifier(expr.name))
                containers = getSafetyContainersInExpr(expr.name);
            else //* PrivateIdentifier는 어차피 액세스 불가이니 취급안함
                ;
        } else if (ts.isLiteralKind(expr.kind)) {
            //* Literal은 Symbol 없음
        }
        return containers;

        function addAll(source: Set<ts.SafetyContainer>) {
            source.forEach(ele => containers.add(ele));
        }
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
                    setContainerSafety(symbol, explicitSafety);
                    if (explicitSafety === Safety.Unsafe)
                        propagateUnsafety({
                            container: symbol,
                            node: name,
                        }, symbol, name);
                }
            // }

            if (ts.isFunctionDeclaration(node)) {
                const signature = checker.getSignatureFromDeclaration(node);
                signature.isExternal = symbol.isExternal;
            }
        }
    }

    function connectSafetyFlow(targetNode: ts.Node, sourceNode: ts.Node, target: ts.SafetyContainer, source: ts.SafetyContainer) {
        if (!target || ! source) return;
        if (target === source) return;
        log.debug(`${getNodeLoc(targetNode)}: Connect safety flow from ${getContainerDisplayName(source)}`);
        analysisResult.totalFlow += 1;
        if (!source.flowsTo) source.flowsTo = new Set();
        // const target = getSymbolAtLocation(targetNode);
        const newFlow = { container: target, node: targetNode };
        source.flowsTo.add(newFlow);

        if (source.safety === Safety.Unsafe)
            propagateUnsafety(newFlow, source, sourceNode);
    }

    function propagateUnsafety(target: ts.FlowInfo, source: ts.SafetyContainer, sourceNode: ts.Node) {
        if (target.container.safety === Safety.Safe) {
            report(sourceNode, 
                `Unsafe "${getContainerDisplayName(source)}" flows to "${getContainerDisplayName(target.container)}"`);
            analysisResult.totalPropagation += 1;
            return;
        }

        if (target.container.isExternal) return;

        log.debug(`${getNodeLoc(target.node)}: Unsafety propagated from ${getContainerDisplayName(source)}`);
        setContainerSafety(target.container, Safety.Unsafe);
        analysisResult.totalPropagation += 1;

        target.container.flowsTo?.forEach((flowInfo) => {
            propagateUnsafety(flowInfo, target.container, target.node);
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
                    const containers = getSafetyContainersInExpr(source);
                    const targetSymbol = getSymbolAtLocation(target);
    
                    containers.forEach(container => {
                        connectSafetyFlow(target, source, targetSymbol, container);
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
                const containers = getSafetyContainersInExpr(source);
    
                containers.forEach(container => {
                    connectSafetyFlow(target, source, targetSymbol, container);
                });
            } else if (explicitSafety === Safety.Unsafe && targetSymbol.safety === Safety.Safe) {
                report(node, `Unsafe assignment`);
            }
        } else if (ts.isReturnStatement(node)) {
            //* 리턴 값 중 Unsafe가 있으면 함수도 Unsafe
            const funcDeclaration = ts.getContainingFunctionDeclaration(node);
            const signature = checker.getSignatureFromDeclaration(funcDeclaration);

            if (signature.safety === Safety.Safe) return; //? Explicit Safety있으면 생략

            const expr = node.expression;
            if (expr) {
                const explicitSafety = getExplicitSafety(expr);
                if (!explicitSafety) {
                    const containers = getSafetyContainersInExpr(expr);
    
                    containers.forEach(container => {
                        // TODO : connectSafetyFlow 함수버전 구현하기
                        // setContainerSafety(signature, Safety.Unsafe);
                        connectSafetyFlow(signature.declaration, expr, signature, container);
                        log.info(`${getNodeLoc(funcDeclaration)}: Signature of function "${funcDeclaration.name?.getText()}" is Unsafe`);
                    });
                } else if (explicitSafety === Safety.Unsafe) {
                    setContainerSafety(signature, Safety.Unsafe);
                    log.info(`${getNodeLoc(funcDeclaration)}: Signature of function "${funcDeclaration.name?.getText()}" is Unsafe`);
                }
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
                        const containers = getSafetyContainersInExpr(arg);
                        containers.forEach(container => {
                            connectSafetyFlow(params[i]?.valueDeclaration, arg, params[i], container);
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