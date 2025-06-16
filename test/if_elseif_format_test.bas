' 测试 If-ElseIf-Else 格式化
Sub TestIfElseIf()
    ' 单行 If-Then
    If x > 0 Then y = 1
    
    ' 多行 If-ElseIf-Else
    If x > 10 Then
        y = 10
    ElseIf x > 5 Then
        y = 5
    Else
        y = 0
    End If
    
    ' 嵌套 If-ElseIf
    If a > 0 Then
        If b > 0 Then
            c = 1
        ElseIf b < 0 Then
            c = -1
        End If
    ElseIf a < 0 Then
        d = -1
    End If
    
    ' 混合单行和多行
    If x > 100 Then y = 100 ElseIf x > 50 Then
        y = 50
    Else
        y = 0
    End If
End Sub