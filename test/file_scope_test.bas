' 测试文件作用域变量
File Dim fileVar1, fileVar2 As Integer
File Dim fileArray(10) As String

' 测试全局变量
Global Dim globalVar As Integer

Sub TestScope()
    ' 测试局部变量
    Local localVar As Integer
    
    ' 测试控制块作用域变量
    If True Then
        Local blockVar As Integer
        Print fileVar1  ' 应该可以访问
        Print globalVar ' 应该可以访问
        Print blockVar  ' 应该可以访问
    End If
    
    Print fileVar2     ' 应该可以访问
    Print localVar     ' 应该可以访问
End Sub