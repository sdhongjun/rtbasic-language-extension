# RtBasic Language Support for Visual Studio Code

This extension provides rich language support for the RtBasic programming language in Visual Studio Code.

## Features

RtBasic is a programming language based on VB syntax. This extension provides the following features:

### Syntax Highlighting

Colorization of RtBasic code elements including:

- Keywords and control structures
- Variables (global, file-level, and local)
- Functions and subroutines
- Structures and their members
- Comments and strings

### IntelliSense

- **Code Completion**: Get suggestions for variables, functions, and structure members
- **Parameter Info**: See function parameter information as you type
- **Quick Info**: Hover over symbols to see their definitions
- **Structure Member Completion**: Automatic completion of structure members after typing a dot
- **Block-Scoped Variables**: Smart suggestions for variables based on their scope in control blocks

### Navigation

- **Go to Definition**: Jump to the definition of variables, functions, and structures
- **Find All References**: Find all references to a symbol
- **Document Outline**: See the structure of your code in the outline view

### Code Snippets

Quickly insert common code patterns:

- Global/local/file variables
- Functions and subroutines
- Structures
- Control structures (if, for, while, etc.)

## Supported Language Features

The extension provides special support for the following RtBasic language elements:

- **Global variables**: Defined with `Global Dim`
- **File-level variables**: Defined with `Dim`
- **Local variables**: Defined with `Local` inside functions
- **Block-scoped variables**: Local variables defined within control structures (if, for, while, select)
- **Global functions**: Defined with `Global Sub` or `Global Function`
- **Global structures**: Defined with `Global Structure`

## Variable Scoping

RtBasic supports multiple levels of variable scoping:

1. **Global scope**: Variables defined with `Global Dim` are accessible everywhere
2. **File scope**: Variables defined with `Dim` at file level are accessible within the file
3. **Subroutine scope**: Variables defined with `Local` in a subroutine are accessible within that subroutine
4. **Block scope**: Variables defined with `Local` within control structures are only accessible within that block

## Example

```rtbasic
' Global variables
Global Dim gCounter

' Global structure
Global Structure Person
    Dim firstName As String
    Dim lastName As String
    Dim age As Integer
End Structure

' Global subroutine with block-scoped variables
Global Sub ProcessPerson(ByRef person As Person)
    Local result = True
    
    If person.age >= 18 Then
        Local isAdult = True  ' This variable is only accessible within the If block
        Print "Adult: " + person.firstName + " " + person.lastName
    Else
        Local isChild = True  ' This variable is only accessible within the Else block
        Print "Minor: " + person.firstName + " " + person.lastName
    End If
    
    ' Block-scoped variables in loops
    For i = 1 To 3
        Local counter = i  ' This variable is only accessible within the For loop
        Print "Counter: " + CStr(counter)
    Next i
End Sub
```

## Installation

1. Open VS Code
2. Press `Ctrl+P` to open the Quick Open dialog
3. Type `ext install rtbasic.rtbasic-language-extension` to find the extension
4. Click Install

## Requirements

Visual Studio Code 1.60.0 or higher.

## Extension Settings

This extension contributes the following settings:

- `rtbasic.maxNumberOfProblems`: Controls the maximum number of problems produced by the extension.
- `rtbasic.trace.server`: Traces the communication between VS Code and the RtBasic language server.

## Known Issues

- Structure member completion may not work correctly in complex expressions.
- Some advanced VB syntax features are not yet supported.

## Release Notes

### 0.0.2

Added support for block-scoped variables in control structures (if, for, while, select).

### 0.0.1

Initial release of RtBasic Language Support extension.

## Contributing

Contributions are welcome! Please feel free to submit a Pull Request.

## License

This extension is licensed under the [MIT License](LICENSE).
