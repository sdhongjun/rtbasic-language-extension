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
- **Global functions**: Defined with `Global Sub` or `Global Function`
- **Global structures**: Defined with `Global Structure`

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

' Global subroutine
Global Sub DisplayPerson(ByRef person As Person)
    Print "Name: " + person.firstName + " " + person.lastName
    Print "Age: " + CStr(person.age)
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

* `rtbasic.maxNumberOfProblems`: Controls the maximum number of problems produced by the extension.
* `rtbasic.trace.server`: Traces the communication between VS Code and the RtBasic language server.

## Known Issues

- Structure member completion may not work correctly in complex expressions.
- Some advanced VB syntax features are not yet supported.

## Release Notes

### 0.0.1

Initial release of RtBasic Language Support extension.

## Contributing

Contributions are welcome! Please feel free to submit a Pull Request.

## License

This extension is licensed under the [MIT License](LICENSE).